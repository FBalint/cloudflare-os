// Apply and reject are declarative here; revert is not. Reject's variance lives inside a handler
// body, which dispatch absorbs; revert's variance lives in record lifecycle, which it cannot -- five
// gatekeepers have five incompatible revert/retention behaviours today, so revert is a facet seam
// whose body is ordinary consumer TypeScript.

import { createLogger } from "@gadgets/backend-utils/logger";
import type { RpcStub } from "cloudflare:workers";
import type {
  ActionDescription,
  ActionKind,
  ApprovalQueue,
} from "@gadgets/workshop-shared/gatekeeper";
import { ActionJournal, type JournalRecord } from "./action-journal";
import { SerialTaskQueue } from "./serial-queue";

export {
  ActionJournal,
  type ActionJournalKv,
  type ActionJournalOptions,
  type JournalKeys,
  type JournalRecord,
} from "./action-journal";

type ActionLogFields =
  { outcome: ResolveOutcome; vendorId: string; action: number; stranded: number };

const logger = createLogger<ActionLogFields>({ component: "gatekeeper.actions" });

/**
 * Queue an action for approval: stage it, submit it, and mark it pending. A failed submission is
 * rolled back, so a rejected submission leaves nothing behind for simulation to overlay.
 */
export async function stageAction<A>(
  journal: ActionJournal<A>,
  queue: RpcStub<ApprovalQueue>,
  action: A,
  description: ActionDescription,
): Promise<number> {
  const id = journal.allocate(action);
  try {
    await queue.submitAction(id, description);
  } catch (error) {
    journal.rollbackSubmission(id);
    throw error;
  }
  journal.markSubmitted(id);
  return id;
}

/**
 * Thrown from an `apply` handler to record a terminal, non-replayable failure. The message is
 * display-safe and becomes the stored answer every later resolution attempt sees, and the record
 * stops projecting into simulation; an ordinary throw leaves the action retryable instead.
 *
 * From a `reject` handler it carries no special meaning: reject handlers do no irreversible
 * provider writes, so they have nothing to declare terminal.
 */
export class ActionApplyError extends Error {}

/** The stored answer for a claim an activation died holding: the call went out, and nothing here
 *  can say whether the provider ran it. */
export const APPLY_OUTCOME_UNKNOWN_MESSAGE = "This action was interrupted after it was dispatched, "
  + "so it may or may not have taken effect. Check the provider before submitting it again.";

/** The approver-facing text for one action; its policy fields come from the declaration. */
export type ActionPresentation =
  Pick<ActionDescription, "title" | "description" | "implementsRevert">;

/**
 * What a handler knows besides its payload. `id` is durable, unique per resource and stable across
 * retries, so a provider accepting an idempotency key can derive one from it.
 */
export type ActionContext = { readonly id: number };

/** How one kind of action is described to the approver and carried out once approved. */
export type ActionDefinition<Payload, Host> = {
  kind?: ActionKind;
  /** Whether this kind may ever be auto-applied. The binding per-action verdict stays on each
   *  submitted `ActionDescription`. */
  autoApprovable?: boolean;
  /**
   * Whether this kind's effects appear in later reads before the user decides. Declared, never
   * inferred: it becomes `ActionDescription.awaitDecision`, and a gatekeeper that simulates its
   * pending actions must let the agent keep working while one that does not must not. Independent
   * of `autoApprovable`, `implementsRevert`, and `claimBeforeApply`.
   */
  delivery: "continue-with-simulation" | "await-decision";
  /**
   * Claim the record durably before the handler runs; opt in for an irreversible provider call. A
   * plain thrown error then means the handler classified the failure retryable and the claim is
   * rolled back, an `ActionApplyError` means terminal, and a crash mid-handler leaves a claim a
   * later activation converts into a terminal unknown-outcome failure rather than re-running it.
   */
  claimBeforeApply?: boolean;
  /**
   * Approval text, derived from the payload the journal stores rather than passed in beside it, so
   * what the approver reads cannot drift from what `apply` sends. `host` is available for the
   * enrichment reads a description often needs.
   */
  describe(payload: Payload, host: Host): ActionPresentation | Promise<ActionPresentation>;
  /** Provisional references this payload creates, for actions a later one can depend on. */
  provides?(payload: Payload): Iterable<string>;
  /** Provisional references this payload consumes; retired when their creator never applies. */
  dependsOn?(payload: Payload): Iterable<string>;
  /** Returns `{ action }` to persist apply-time artifacts (created entity ids and the like). */
  apply(payload: Payload, host: Host, ctx: ActionContext): Promise<void | { action?: Payload }>;
  reject?(payload: Payload, host: Host, ctx: ActionContext): Promise<void>;
};

/** How a resolution ended, for cache invalidation. */
export type ResolveOutcome = "applied" | "rejected" | "failed" | "reverted";

/** Cross-cutting policy for a whole action set, as opposed to one kind's behavior. */
export type ActionSetOptions<Host> = {
  /** Keep the applied record so a revert can read it back. The facet derives this from its own
   *  revert hook; set it explicitly only to retain without one. */
  retainApplied?: boolean;
  /**
   * Fires once per resolution, so cache invalidation lives in one place instead of every branch.
   * Advisory: a failure here is logged and dropped, never surfaced to the overseer.
   */
  afterResolve?(host: Host, outcome: ResolveOutcome): void | Promise<void>;
  /** Vendor id for log attribution. */
  vendorId?: string;
};

/** A journal entry tagged with the kind that knows how to resolve it. */
export type TaggedAction<M> = { [K in keyof M]: { kind: K; payload: M[K] } }[keyof M];

/** The action set bound to one resource's journal and host. */
export type BoundActionSet<M extends Record<string, unknown>> = {
  submit<K extends keyof M>(
    queue: RpcStub<ApprovalQueue>, kind: K, payload: M[K]): Promise<number>;
  /**
   * Resolution is serialized: the overseer can deliver two callbacks for one id concurrently, since
   * it validates that a record is still pending and then awaits before dispatching, with the Durable
   * Object's input gate open across that await (`overseer.ts:9485-9495`, and its own comment on
   * `applyPendingAction` says the caller is responsible for the check). Without this the journal
   * check would be a time-of-check/time-of-use window around a provider call, i.e. a double effect.
   *
   * Resolves without effect for an already-applied id, so the overseer's retry in a later
   * activation settles instead of reporting a failure the user cannot act on.
   */
  apply(id: number): Promise<void>;
  reject(id: number): Promise<void>;
  autoApprovableKinds(): ActionKind[];
  /** The retention flag in force, which the facet base's revert-hook assert reads. */
  readonly retainsApplied: boolean;
  /** Reports an outcome the facet resolved itself, so `afterResolve` still covers every site. */
  resolved(outcome: ResolveOutcome): Promise<void>;
  /**
   * Run `hook` exclusively against `apply` and `reject`, which share one queue: revert is a facet
   * seam and retiring the retained tier is consumer policy, and both read back records those
   * verbs rewrite. A second queue beside this one would serialize each pair but leave the
   * cross-pairs interleaved.
   *
   * Never call `apply`/`reject` from inside the callback: they claim this same queue and would wait
   * on their own predecessor.
   */
  runExclusive<T>(hook: () => T | Promise<T>): Promise<T>;
};

/**
 * A declared action set, still unbound: the declarations are module-scoped while the journal and
 * host belong to one resource facet, so `bind` is what a per-instance facet calls to get the
 * submission and resolution surface for its own storage.
 */
export type ActionSet<Host, M extends Record<string, unknown>> = {
  bind(journal: ActionJournal<TaggedAction<M>>, host: Host): BoundActionSet<M>;
};

/** One pending action's provisional references, as its definition reports them. */
type ActionRefs = { id: number; provides: string[]; dependsOn: string[] };

/**
 * The ids that can never apply once `dead` goes unresolved, transitively: a stranded action's own
 * references are dead too. Derived from one journal scan per decision rather than a stored
 * dependents list, so there is nothing to keep in step, and it is bounded by the pending cap.
 */
function strandedBy(dead: readonly string[], pending: readonly ActionRefs[]): number[] {
  const dependents = new Map<string, number[]>();
  const provides = new Map<number, string[]>();
  for (const entry of pending) {
    provides.set(entry.id, entry.provides);
    for (const ref of entry.dependsOn) {
      const waiting = dependents.get(ref);
      if (waiting) waiting.push(entry.id);
      else dependents.set(ref, [entry.id]);
    }
  }

  const stranded = new Set<number>();
  // Appended to while it is walked, which is how the cascade reaches dependents of dependents.
  const unresolved = [...dead];
  for (const ref of unresolved) {
    for (const id of dependents.get(ref) ?? []) {
      if (stranded.has(id)) continue;
      stranded.add(id);
      unresolved.push(...(provides.get(id) ?? []));
    }
  }
  return [...stranded];
}

/**
 * Declare a resource's actions once; the returned set owns submission and the overseer's
 * apply/reject callbacks, leaving each definition to describe only its own effect.
 *
 * Apply is at-least-once by default: the provider call can succeed and the process crash before the
 * journal write, and the overseer's retry then re-applies. `claimBeforeApply` makes that crash
 * at-most-once, but not a handler's own throw — a plain throw declares the failure retryable, so a
 * handler that cannot prove its request never left must throw `ActionApplyError`.
 */
export function defineActions<Host, M extends Record<string, unknown>>(
  definitions: { [K in keyof M]: ActionDefinition<M[K], Host> },
  options: ActionSetOptions<Host> = {},
): ActionSet<Host, M> {
  const labelByTag = new Map<string, string>();
  // One entry per tag: siblings sharing one are governed as a group, and the loop below rejects a
  // tag whose siblings disagree about the label.
  const autoApprovableByTag = new Map<string, ActionKind>();
  for (const [name, definition] of Object.entries(definitions) as [string, ActionDefinition<unknown, Host>][]) {
    // Auto-approval rules key on the tag, so without a kind the flag could never take effect.
    if (definition.autoApprovable === true && !definition.kind) {
      throw new Error(`Action "${name}" declares autoApprovable without a kind.`);
    }
    if (definition.kind === undefined) continue;

    // The catalog advertises one label per tag, so a second spelling would put a name in the
    // approval UI that does not cover everything enabling that tag authorizes.
    const { tag, label } = definition.kind;
    const declared = labelByTag.get(tag);
    if (declared === undefined) labelByTag.set(tag, label);
    else if (declared !== label) {
      throw new Error(`Action tag "${tag}" is declared with two labels, "${declared}" and "${label}".`);
    }
    if (definition.autoApprovable === true) autoApprovableByTag.set(tag, definition.kind);
  }

  return {
    bind(journal, host) {
      // TypeScript cannot correlate a tagged union's payload with its definition, so the dispatcher
      // is the one place that erases the payload type.
      const definitionFor = (entry: TaggedAction<M>) =>
        definitions[entry.kind] as ActionDefinition<unknown, Host> | undefined;

      /**
       * Ids this instance applied, for a non-retaining set where the journal keeps no trace.
       *
       * The overseer can deliver approve and reject for one id concurrently (`overseer.ts:9622`),
       * and a reject finding no record would report success for an action the provider ran. In
       * memory because the other reject-on-missing case -- the overseer's retry after crashing
       * before its own state write -- must still no-op, and that retry is a later activation while
       * this race needs both calls in flight in one.
       */
      const appliedHere = new Set<number>();

      /**
       * Ids this activation claimed. A claimed record missing from here was orphaned by an
       * activation that died mid-dispatch: the provider call went out and its outcome is unknowable,
       * so no verb may run a handler over it. In memory for the same reason as `appliedHere`.
       */
      const claimedHere = new Set<number>();

      /**
       * The record behind an id when the overseer may still decide on it, or undefined when none
       * exists. An id this instance applied is refused as decided rather than reported unknown: for
       * a set that keeps no record it is the only trace that the provider ran.
       */
      const pendingRecord = (id: number): JournalRecord<TaggedAction<M>> | undefined => {
        const record = journal.get(id);
        if (record === undefined && appliedHere.has(id)) {
          throw new Error(`Action ${id} is no longer pending.`);
        }
        return record;
      };

      // One queue per bound resource, covering every resolution of it -- and whatever the facet
      // runs through `runExclusive`. `submit` deliberately stays off it:
      // submission is not a resolution, and queueing it behind a slow apply would stall the agent
      // for the length of a provider call.
      const resolutionQueue = new SerialTaskQueue();

      /**
       * Fire the invalidation hook. Awaited, so a read after this resolution sees fresh caches --
       * but its failure never escapes: the hook is advisory, and letting it throw would either
       * replace a provider's display-safe error or report a completed action as failed.
       */
      const attributed = options.vendorId ? logger.with({ vendorId: options.vendorId }) : logger;
      const resolved = async (outcome: ResolveOutcome) => {
        try {
          await options.afterResolve?.(host, outcome);
        } catch (error) {
          attributed.error("afterResolve hook failed", {
            event: "actions.afterResolve.failed",
            outcome,
            error,
          });
        }
      };

      /**
       * Retire every queued action whose references this decision just made unresolvable. They fail
       * with a reason rather than vanishing, so a later overseer callback for one reports it.
       *
       * Advisory like `afterResolve`: the parent's decision is already durable, and on the failure
       * paths must be, so a throw here would lose the cascade with nothing to resume from.
       */
      const strandDependents = (id: number, action: TaggedAction<M>): void => {
        try {
          const dead = [...(definitionFor(action)?.provides?.(action.payload) ?? [])];
          if (dead.length === 0) return;

          // A staged dependent is missed, and answered by that same check instead.
          const stranded = strandedBy(dead, journal.listUndecided().map(record => {
            const definition = definitionFor(record.action);
            return {
              id: record.id,
              provides: [...(definition?.provides?.(record.action.payload) ?? [])],
              dependsOn: [...(definition?.dependsOn?.(record.action.payload) ?? [])],
            };
          }));
          for (const strandedId of stranded) {
            journal.markFailed(
              strandedId, `This action needed action ${id}, which was not applied.`);
          }
          if (stranded.length > 0) {
            attributed.debug("retired actions left unresolvable by a decision", {
              event: "actions.dependents.stranded",
              action: id,
              stranded: stranded.length,
            });
          }
        } catch (error) {
          attributed.error("failed to retire stranded dependents", {
            event: "actions.dependents.stranded.failed",
            action: id,
            error,
          });
        }
      };

      /** Convert an orphaned claim into a terminal failure. Both verbs refuse it the same way: a
       *  quiet remove would hide from the user that the effect may already have happened. */
      const failOrphanedClaim = async (id: number, action: TaggedAction<M>): Promise<never> => {
        journal.markFailed(id, APPLY_OUTCOME_UNKNOWN_MESSAGE);
        strandDependents(id, action);
        await resolved("failed");
        throw new Error(APPLY_OUTCOME_UNKNOWN_MESSAGE);
      };

      const applyRecord = async (id: number): Promise<void> => {
        // Idempotent for the overseer's retry in a later activation: the effect and the journal
        // write both happened, so there is nothing left to do and nothing to invalidate.
        if (journal.isRetained(id)) return;

        const record = pendingRecord(id);
        if (record === undefined) throw new Error(`Unknown pending action: ${id}`);
        // A terminal failure answers every later attempt with the same message, no provider call.
        if (record.state === "failed") {
          throw new Error(record.error ?? "This action already failed and cannot be retried.");
        }
        if (record.state === "claimed" && !claimedHere.has(id)) {
          return failOrphanedClaim(id, record.action);
        }

        const action = record.action;
        const definition = definitionFor(action);
        // A kind this deploy dropped. Failing terminally stops it projecting into reads and opens
        // the reject-a-failure path below, which needs no definition.
        if (definition === undefined) {
          const message =
            `Action ${id} has kind "${String(action.kind)}", which this gatekeeper no longer ` +
            "supports. Reject it to clear it.";
          journal.markFailed(id, message);
          await resolved("failed");
          throw new Error(message);
        }
        try {
          let result: void | { action?: unknown };
          try {
            if (definition.claimBeforeApply) {
              journal.markClaimed(id);
              claimedHere.add(id);
            }
            result = await definition.apply(action.payload, host, { id });
          } catch (error) {
            // Only the handler is caught. Caches are at their stalest here either way: the provider
            // may have applied part of the effect. A terminal failure stores its own message;
            // anything else is left retryable, and rolling the claim back is what lets a second
            // dispatch reach the provider.
            if (error instanceof ActionApplyError) {
              journal.markFailed(id, error.message);
              strandDependents(id, action);
            } else journal.restorePending(id);
            await resolved("failed");
            throw error;
          }

          // One write: the artifacts the handler returned, merged with the state transition. A
          // failure here is deliberately outside the catch above: the provider effect has landed,
          // so restoring `pending` would offer the user a second irreversible apply. The claim
          // stays, and the next attempt reports the unknown outcome.
          const applied = result?.action === undefined
            ? undefined
            : { kind: action.kind, payload: result.action } as TaggedAction<M>;
          if (options.retainApplied) journal.retain(id, applied);
          else journal.remove(id);
          appliedHere.add(id);
          await resolved("applied");
        } finally {
          claimedHere.delete(id);
        }
      };

      const rejectRecord = async (id: number): Promise<void> => {
        // The retained record is what a revert hook reads back, so a stray reject must not take it:
        // unlike apply, this one has no idempotent reading.
        if (journal.isRetained(id)) throw new Error(`Action ${id} is no longer pending.`);

        const record = pendingRecord(id);
        if (record === undefined) return;
        if (record.state === "failed") {
          // Nothing to undo, so rejecting a terminal failure is the user clearing the record.
          journal.remove(id);
          await resolved("rejected");
          return;
        }
        if (record.state === "claimed" && !claimedHere.has(id)) {
          return failOrphanedClaim(id, record.action);
        }

        const action = record.action;
        try {
          await definitionFor(action)?.reject?.(action.payload, host, { id });
        } catch (error) {
          // Same reasoning as a failed apply: the handler may have half-changed simulation state.
          await resolved("failed");
          throw error;
        }
        journal.remove(id);
        strandDependents(id, action);
        await resolved("rejected");
      };

      return {
        submit: async (queue, kind, payload) => {
          const definition = definitions[kind];
          const { title, description, implementsRevert } = await definition.describe(payload, host);
          return stageAction(journal, queue, { kind, payload } as TaggedAction<M>, {
            // Projected, not spread: a port returning a full `ActionDescription` here would
            // otherwise carry its own `awaitDecision` past the delivery the definition declares.
            title,
            description,
            implementsRevert,
            autoApprovable: definition.autoApprovable === true,
            // Spread, so a kindless or simulating action puts no key on the wire at all.
            ...(definition.kind ? { actionKind: definition.kind } : {}),
            ...(definition.delivery === "await-decision" ? { awaitDecision: true } : {}),
          });
        },

        apply: id => resolutionQueue.run(() => applyRecord(id)),

        reject: id => resolutionQueue.run(() => rejectRecord(id)),

        autoApprovableKinds: () => [...autoApprovableByTag.values()],

        retainsApplied: options.retainApplied === true,

        resolved,

        runExclusive: hook => resolutionQueue.run(hook),
      };
    },
  };
}
