// Durable record of the actions a resource has queued: the two-tier keyspace `./actions` resolves
// against, and the capacity rule that keeps its pending scan bounded.

import type { SimulationRecord } from "./simulation";
import { requirePositiveInt } from "./positive-int";

/** The Durable Object KV surface used by the action journal. */
export type ActionJournalKv = {
  get<T>(key: string): T | undefined;
  put<T>(key: string, value: T): void;
  delete(key: string): void;
  list<T>(options: { prefix: string }): Iterable<[string, T]>;
};

/** Storage keys, overridable so a port keeps reading the records it already wrote. */
export type JournalKeys = {
  nextIdKey?: string;
  /** Must not contain `nextIdKey`, which would then be scanned as a record. */
  recordPrefix?: string;
};

/**
 * Where a record sits. `"applied"` exists only in the retained tier; `"claimed"` means a dispatch
 * is in flight against the provider, and `"failed"` that one ended terminally.
 */
type JournalState = "staged" | "pending" | "claimed" | "failed" | "applied";

/** A stored action and where it sits. `error` is present only on a `"failed"` record. */
export type JournalRecord<A> = { state: JournalState; action: A; error?: string };

/** The states a read simulates: an in-flight dispatch is still part of the pending world, while
 *  `staged` is not yet the overseer's and `failed` must stop projecting. */
const PROJECTED: readonly JournalState[] = ["pending", "claimed"];

/** The states a decision may still retire. Deliberately not `PROJECTED`: see `listUndecided`. */
const UNDECIDED: readonly JournalState[] = ["pending"];

/**
 * Marks a record this journal wrote. What this resource stored before adopting the journal is
 * `{ action, state }` too, with its own discriminants (github's actions key on `type`, not `kind`),
 * so shape alone cannot tell them apart — an unmarked record goes to `upgradeRecord` instead of
 * being trusted as current.
 */
const JOURNAL_VERSION = 1;

type StoredJournalRecord<A> = JournalRecord<A> & { v: typeof JOURNAL_VERSION };

/** Unresolved actions one resource may hold. A kit default, not any port's historical limit. */
const DEFAULT_MAX_PENDING = 50;

export type ActionJournalOptions<A> = JournalKeys & {
  /** Reads a record written before this gatekeeper adopted the journal. */
  upgradeRecord?(raw: unknown): A;
  /**
   * How many unresolved actions this resource may hold, enforced by `allocate`. Defaults to 50.
   *
   * Only a record awaiting a user decision counts: a `staged` one was never delivered to the
   * overseer and a `failed` one is cleared by rejecting it, so neither may hold a slot the user has
   * no way to free. Both are instead bounded by this same number, oldest id first, since both live
   * under the scanned prefix.
   *
   * Accepted edge: pruning a `staged` record takes more than `maxPending` concurrent in-flight
   * submissions on one resource. The oldest then loses its record, its `markSubmitted` no-ops, and
   * the action surfaces later as `Unknown pending action`.
   */
  maxPending?: number;
};

/**
 * Durable record of the actions this resource has queued.
 *
 * Two tiers: staged and pending records live under `recordPrefix`, and a retained applied record
 * moves to a sibling prefix, so `listPending()`'s scan stays bounded by genuinely pending records
 * however many applied ones accumulate (the shape github already uses). Lookups check both.
 * Retiring the retained tier is consumer policy -- retention is unbounded and caps are per-vendor.
 */
export class ActionJournal<A> {
  readonly #kv: ActionJournalKv;
  readonly #nextIdKey: string;
  readonly #prefix: string;
  readonly #retainedPrefix: string;
  readonly #upgradeRecord?: (raw: unknown) => A;
  readonly #maxPending: number;

  constructor(kv: ActionJournalKv, options: ActionJournalOptions<A> = {}) {
    this.#kv = kv;
    this.#nextIdKey = options.nextIdKey ?? "pending:nextActionId";
    this.#prefix = options.recordPrefix ?? "pending:action:";
    // Outside the pending prefix, not beneath it: a retained record must fall out of that scan.
    this.#retainedPrefix = `retained:${this.#prefix}`;
    this.#upgradeRecord = options.upgradeRecord;
    this.#maxPending = requirePositiveInt("maxPending", options.maxPending ?? DEFAULT_MAX_PENDING);

    // Only ports pass these, and a silent overlap corrupts the keyspace: a counter under the record
    // prefix is scanned as a record, and a record prefix under the retained one un-tiers the scan.
    if (!this.#prefix) throw new Error("recordPrefix must not be empty.");
    if (this.#nextIdKey.startsWith(this.#prefix) || this.#prefix.startsWith(this.#nextIdKey)
      || this.#nextIdKey.startsWith(this.#retainedPrefix)) {
      throw new Error(`nextIdKey "${this.#nextIdKey}" overlaps a record prefix.`);
    }
    if (this.#retainedPrefix.startsWith(this.#prefix)) {
      throw new Error(`recordPrefix "${this.#prefix}" would contain its own retained tier.`);
    }
  }

  /** Reserve the next id and stage the action against it. */
  allocate(action: A): number {
    this.#requireCapacity();
    const id = this.#kv.get<number>(this.#nextIdKey) ?? 1;
    this.#kv.put(this.#nextIdKey, id + 1);
    this.#write(`${this.#prefix}${id}`, { state: "staged", action });
    return id;
  }

  /**
   * The overseer has the action; it is now awaiting a decision. Only a record still staged in the
   * pending tier moves: an auto-approval can apply and retain the record while `submitAction` is
   * still in flight, and stamping "pending" over that would contradict a completed apply.
   */
  markSubmitted(id: number): void {
    this.#transition(id, ["staged"], "pending");
  }

  /** A dispatch is in flight against the provider. Durable, so a later activation can tell an
   *  interrupted apply from one that never started. */
  markClaimed(id: number): void {
    this.#transition(id, ["staged", "pending"], "claimed");
  }

  /** The claimed dispatch failed in a way the user can retry, so the record awaits a decision again. */
  restorePending(id: number): void {
    this.#transition(id, ["claimed"], "pending");
  }

  /**
   * The action failed terminally: it stops projecting into simulation, and `error` becomes the
   * answer every later resolution attempt sees. Only rejecting it clears the record.
   */
  markFailed(id: number, error: string): void {
    this.#transition(id, ["staged", "pending", "claimed"], "failed", error);
  }

  /** Submission failed, so the action was never queued -- unless it was already resolved. */
  rollbackSubmission(id: number): void {
    if (this.#isStaged(id)) this.remove(id);
  }

  /**
   * The record behind an id, in any state, preferring the retained tier. A lookup must never filter
   * by state: the output gate commits the staged record before the `submitAction` RPC can leave, so
   * a record still marked "staged" may already be pending for the overseer. It must prefer the
   * retained copy, because an interrupted `retain` leaves the id in both tiers and the applied
   * record is the true one -- it carries the apply-time artifacts a revert hook reads back.
   */
  get(id: number): JournalRecord<A> | undefined {
    return this.#read(`${this.#retainedPrefix}${id}`) ?? this.#read(`${this.#prefix}${id}`);
  }

  /**
   * Move the record to the retained tier as "applied", optionally replacing the action with one
   * carrying apply-time artifacts. This is the whole post-apply write: one writer, one record.
   *
   * Retained record first, then the delete: a throw does not roll back the implicit transaction
   * (see `credentials.ts`), and this runs just after a provider effect. Losing the record would
   * leave nothing to revert from; a failed delete leaves the id in both tiers, which `get` and
   * `listPending` both resolve in the retained tier's favour, so it still reads as applied
   * everywhere.
   */
  retain(id: number, action?: A): void {
    const record = this.get(id);
    if (!record) return;
    this.#write(`${this.#retainedPrefix}${id}`, {
      state: "applied",
      action: action ?? record.action,
    });
    this.#kv.delete(`${this.#prefix}${id}`);
  }

  /**
   * Forget the id in both tiers. The kit calls this for a rejection and a rolled-back submission;
   * a consumer's own use is retiring its retained tier, which is consumer policy (above).
   */
  remove(id: number): void {
    this.#kv.delete(`${this.#prefix}${id}`);
    this.#kv.delete(`${this.#retainedPrefix}${id}`);
  }

  /**
   * True when this id has been applied and retained. Reads through the same coercion as every other
   * lookup: a value this journal would refuse to return from `get()` must not be reported as a
   * retained record either, or the two answers disagree about whether the action exists.
   */
  isRetained(id: number): boolean {
    return this.#read(`${this.#retainedPrefix}${id}`) !== undefined;
  }

  /** Actions a read simulates, ascending — the input `createSimulationView` expects. */
  listPending(): SimulationRecord<A>[] {
    return this.#scan(PROJECTED);
  }

  /**
   * Actions the overseer may still decide on, ascending. A claimed dispatch is excluded because its
   * outcome is unknown: nothing may retire it, and nothing may treat the effect it would have had
   * as certain not to have happened.
   */
  listUndecided(): SimulationRecord<A>[] {
    return this.#scan(UNDECIDED);
  }

  /** One bounded pass over the pending tier, keeping the records sitting in `states`. */
  #scan(states: readonly JournalState[]): SimulationRecord<A>[] {
    const found: SimulationRecord<A>[] = [];
    for (const [key, raw] of this.#kv.list<unknown>({ prefix: this.#prefix })) {
      const record = this.#coerce(raw);
      if (record === undefined || !states.includes(record.state)) continue;
      const id = this.#idFrom(key);
      // A record left behind by an interrupted `retain` is applied, not pending: projecting it
      // would simulate an effect the provider has already made real.
      if (id === undefined || this.isRetained(id)) continue;
      found.push({ id, action: record.action });
    }
    return found.toSorted((a, b) => a.id - b.id);
  }

  /**
   * Enforce `maxPending` before an allocation, and bound the records sitting beside the unresolved
   * ones. One scan does both, and the scan is bounded by what it enforces.
   *
   * Neither `staged` nor `failed` awaits a user decision -- one was never delivered to the overseer,
   * the other is cleared by rejecting it -- so neither counts against the cap, which the user would
   * otherwise have no way to free. Both live under the scanned prefix, so left alone they would grow
   * every future scan without limit; past the same bound the oldest are dropped, the newest being
   * the ones the user still has on screen.
   */
  #requireCapacity(): void {
    const max = this.#maxPending;
    let unresolved = 0;
    const prunable: number[] = [];
    for (const [key, raw] of this.#kv.list<unknown>({ prefix: this.#prefix })) {
      const state = this.#coerce(raw)?.state;
      if (state === undefined) continue;
      const id = this.#idFrom(key);
      if (state === "staged" || state === "failed") {
        // Same retained-tier test as below: an interrupted `retain` leaves a stale source record
        // here, and `remove` would take the applied record with it.
        if (id !== undefined && !this.isRetained(id)) prunable.push(id);
      } else if (id === undefined || !this.isRetained(id)) {
        // An interrupted `retain` leaves an applied record here too, and the retained tier decides
        // as it does for `get` and `listPending`. Counted, it would hold a slot for good.
        unresolved += 1;
      }
    }
    if (unresolved >= max) {
      throw new Error(
        "Too many pending actions; approve or reject some in the approval queue first.");
    }
    // Guarded, because a negative end counts back from the array's own length: under the bound,
    // `slice(0, -n)` would drop the oldest records the user is still owed an answer for.
    const excess = prunable.length - max;
    if (excess > 0) {
      for (const id of prunable.toSorted((a, b) => a - b).slice(0, excess)) this.remove(id);
    }
  }

  /** The id a scanned record key names, or undefined when the key is not one this journal wrote. */
  #idFrom(key: string): number | undefined {
    const id = Number(key.slice(this.#prefix.length));
    return Number.isInteger(id) ? id : undefined;
  }

  /**
   * Rewrite a pending-tier record that is in one of `from`. A record in any other state is left
   * alone, which is what keeps a resolved or terminally failed one from being revived.
   */
  #transition(id: number, from: JournalState[], next: JournalState, error?: string): void {
    const key = `${this.#prefix}${id}`;
    const record = this.#read(key);
    if (record === undefined || !from.includes(record.state)) return;
    const { action } = record;
    this.#write(key, error === undefined ? { state: next, action } : { state: next, action, error });
  }

  #isStaged(id: number): boolean {
    return this.#read(`${this.#prefix}${id}`)?.state === "staged";
  }

  #write(key: string, record: JournalRecord<A>): void {
    this.#kv.put<StoredJournalRecord<A>>(key, { ...record, v: JOURNAL_VERSION });
  }

  #read(key: string): JournalRecord<A> | undefined {
    return this.#coerce(this.#kv.get<unknown>(key));
  }

  #coerce(raw: unknown): JournalRecord<A> | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    if ("v" in raw && raw.v === JOURNAL_VERSION) {
      // The marker is storage detail; callers see the record only.
      const { state, action, error } = raw as StoredJournalRecord<A>;
      return error === undefined ? { state, action } : { state, action, error };
    }
    // Anything else was written by whatever this gatekeeper stored before adopting the journal,
    // and since it only kept records awaiting approval, it was pending.
    const upgraded = this.#upgradeRecord?.(raw);
    return upgraded === undefined ? undefined : { state: "pending", action: upgraded };
  }
}
