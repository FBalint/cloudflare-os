/** The Durable Object KV surface used by the cache. */
export type CacheKv = Pick<DurableObjectStorage["kv"], "get" | "put">;

type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
  generation: number;
  authority: string;
};

/**
 * Where entries and the generation counter live. Fixed: a resource's cache families are segments
 * within the caller's own `key` (`page:…`, `schema:…`), and their freshness is already per-read.
 */
const CACHE_PREFIX = "cache:";

/**
 * Durable cache for stable, read-only provider metadata, partitioned by authority and keyed within a
 * generation the caller bumps when an applied action may have invalidated everything (a schema
 * change, say) -- cheaper and more complete than tracking which entries a write touched.
 *
 * Filling is the cache's own job rather than a get/put pair at each call site, because the load
 * spans an await: an applied action can bump the generation while one is in flight, and a value
 * stamped with the generation current when it *returns* would reinstate exactly what that bump
 * invalidated, then serve it for the whole `ttlMs`.
 */
export class KvTtlCache {
  readonly #kv: CacheKv;
  readonly #authority: string;
  readonly #loads = new Map<string, Promise<unknown>>();

  /**
   * `authorityId` must be an opaque, non-secret identity covering the account, resource scope, and
   * every policy that can change provider output. It must not be an email or display value.
   */
  constructor(kv: CacheKv, authorityId: string) {
    this.#kv = kv;
    this.#authority = authorityId;
  }

  /**
   * The cached value, or `load()`'s -- kept for later callers, and shared with concurrent ones.
   *
   * The generation is read before the load and again after it. A bump in between means the value
   * describes a state that bump declared stale, so it is handed to this caller (which asked before
   * the change) but not stored.
   *
   * `T` is asserted, not checked: one key holds one type for the life of the deployment, since a
   * generation bump does not protect a shape that changed across deploys. `ttlMs` is the reader's
   * choice, so two callers may disagree about whether the same entry is fresh. `load` must resolve
   * to a structured-cloneable value: the store happens in its continuation, so a value KV refuses
   * fails this call after the provider round trip.
   */
  async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const entryKey = `${CACHE_PREFIX}entry:${key}`;
    const generation = this.#generation();
    const entry = this.#kv.get<CacheEntry<T>>(entryKey);
    if (entry?.authority === this.#authority && entry.generation === generation
      && Date.now() - entry.fetchedAt < ttlMs) {
      return entry.value;
    }

    // Keyed by generation too, so a load started before a bump is never shared with a caller that
    // arrived after it.
    const loadKey = `${generation}:${key}`;
    const loading = (this.#loads.get(loadKey) as Promise<T> | undefined)
      ?? load().then(value => {
        if (this.#generation() === generation) {
          this.#kv.put<CacheEntry<T>>(entryKey,
            { value, fetchedAt: Date.now(), generation, authority: this.#authority });
        }
        return value;
      });
    this.#loads.set(loadKey, loading);
    try {
      return await loading;
    } finally {
      // Only when it is still the promise this frame installed, as in `CredentialSource`.
      if (this.#loads.get(loadKey) === loading) this.#loads.delete(loadKey);
    }
  }

  /**
   * Invalidate every entry at once. The generation remains shared across authorities: that may
   * over-invalidate, while authority-stamped entries already prevent under-invalidation.
   */
  invalidateAll(): void {
    this.#kv.put(`${CACHE_PREFIX}generation`, this.#generation() + 1);
  }

  #generation(): number {
    return this.#kv.get<number>(`${CACHE_PREFIX}generation`) ?? 0;
  }
}
