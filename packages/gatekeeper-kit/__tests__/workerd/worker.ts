// Fixture for the suites that need real Durable Object storage rather than the cloning Node fake.

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { ObserverTracker } from "../../src/observers";

type VerifierProps = { allowed: readonly string[]; dropVerdicts?: number };

/**
 * A verifier reached the way the overseer's is: a `WorkerEntrypoint` behind a service binding, which
 * is what makes it a *persistent* stub. An ad-hoc `RpcTarget` has no durable address and Durable
 * Object storage refuses it outright, flag or no flag.
 */
export class FixtureVerifier extends WorkerEntrypoint<unknown, VerifierProps> {
  async hasSets(setIds: readonly string[]): Promise<boolean[]> {
    const verdicts = setIds.map(setId => this.ctx.props.allowed.includes(setId));
    return verdicts.slice(0, verdicts.length - (this.ctx.props.dropVerdicts ?? 0));
  }
}

type Verifier = { hasSets(setIds: readonly string[]): Promise<boolean[]> };

/** Drives a tracker whose storage is a real DO's, so a persisted stub is a persisted stub. */
export class TrackerHost extends DurableObject {
  readonly #tracker = new ObserverTracker<Verifier>({
    kv: this.ctx.storage.kv,
    hasSetAccess: (verifier, setIds) => verifier.hasSets(setIds),
  });

  async admit(id: string, props: VerifierProps): Promise<void> {
    await this.#tracker.addObserver(id, this.ctx.exports.FixtureVerifier({ props }));
  }

  observerIds(): string[] {
    return this.#tracker.observerIds();
  }

  /** Reveals `setIds`, commits, and reports who the read had to be hidden from. */
  async reveal(setIds: string[]): Promise<string[]> {
    const check = await this.#tracker.prepareObservation(setIds);
    const excluded = [...(check.excludeObservers ?? [])];
    check.commit();
    return excluded;
  }

  /** Proves the stub survived the write: re-read from storage and call it. */
  async askStored(id: string, setIds: string[]): Promise<boolean[] | undefined> {
    return await this.ctx.storage.kv.get<Verifier>(`observer:${id}`)?.hasSets(setIds);
  }
}

export default {
  fetch: () => new Response("fixture", { status: 404 }),
};
