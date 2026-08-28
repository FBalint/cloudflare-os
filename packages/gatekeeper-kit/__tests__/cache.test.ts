import { afterEach, describe, expect, it, vi } from "vitest";
import { KvTtlCache, type CacheKv } from "../src/cache";
import { fakeKv } from "./fake-kv";

function makeKv(): CacheKv {
  return fakeKv();
}

afterEach(() => void vi.useRealTimers());

describe("KvTtlCache", () => {
  it("loads once, then serves the entry until its TTL elapses", async () => {
    vi.useFakeTimers();
    const cache = new KvTtlCache(makeKv(), "authority");
    const load = vi.fn(async () => ({ name: "acme" }));

    expect(await cache.cached("project", 1000, load)).toEqual({ name: "acme" });
    vi.advanceTimersByTime(999);
    expect(await cache.cached("project", 1000, load)).toEqual({ name: "acme" });
    expect(load).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1);
    expect(await cache.cached("project", 1000, load)).toEqual({ name: "acme" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads every entry after invalidating all", async () => {
    const cache = new KvTtlCache(makeKv(), "authority");
    await cache.cached("a", 60_000, async () => 1);
    await cache.cached("b", 60_000, async () => 2);

    cache.invalidateAll();
    expect(await cache.cached("a", 60_000, async () => 3)).toBe(3);
    expect(await cache.cached("b", 60_000, async () => 4)).toBe(4);

    // Reloaded against the new generation, so the entry is live again.
    expect(await cache.cached("a", 60_000, async () => 5)).toBe(3);
  });

  it("does not store a value invalidated during a load", async () => {
    const cache = new KvTtlCache(makeKv(), "authority");
    const { promise, resolve } = Promise.withResolvers<number>();

    const loading = cache.cached("schema", 60_000, () => promise);
    cache.invalidateAll();
    resolve(1);

    // This caller asked before invalidation, so it still receives what it waited for.
    expect(await loading).toBe(1);
    // The entry was not kept: it describes the state the invalidation declared stale.
    expect(await cache.cached("schema", 60_000, async () => 2)).toBe(2);
  });

  it("does not serve an entry written under another authority", async () => {
    const kv = makeKv();
    const authorityA = new KvTtlCache(kv, "a");
    const authorityB = new KvTtlCache(kv, "b");
    await authorityA.cached("project", 60_000, async () => "from a");
    const load = vi.fn(async () => "from b");

    expect(await authorityB.cached("project", 60_000, load)).toBe("from b");
    expect(load).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent loads for one key", async () => {
    const cache = new KvTtlCache(makeKv(), "authority");
    const { promise, resolve } = Promise.withResolvers<number>();
    const load = vi.fn(() => promise);

    const first = cache.cached("project", 60_000, load);
    const second = cache.cached("project", 60_000, load);
    expect(load).toHaveBeenCalledOnce();
    resolve(1);

    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
  });
});
