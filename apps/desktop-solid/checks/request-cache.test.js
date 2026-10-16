import { describe, expect, test } from 'bun:test';
import { CacheInvalidatedError, RequestCache } from '../src/platform/cache/request-cache.ts';

function setup(overrides = {}) {
  let now = 0;
  const cache = new RequestCache({ maxEntries: 2, staleTimeMs: 10, retentionMs: 100, now: () => now, ...overrides });
  return { cache, advance: (ms) => { now += ms; } };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('request cache correctness', () => {
  test('100 concurrent consumers share one request; warm reads avoid loading', async () => {
    const { cache } = setup();
    let calls = 0;
    const loader = async () => { calls++; return []; };
    await Promise.all(Array.from({ length: 100 }, () => cache.read('list', loader)));
    await cache.read('list', loader);
    expect(calls).toBe(1);
    expect(cache.metrics.deduplicated).toBe(99);
    expect(cache.metrics.hits).toBe(1);
    expect(cache.peek('list').hasData).toBe(true); // [] is valid data, not a miss
  });

  test('stale data remains visible during refresh and a failed refresh', async () => {
    const { cache, advance } = setup();
    cache.seed('list', ['saved']);
    advance(10);
    const work = deferred();
    const read = cache.read('list', () => work.promise);
    expect(cache.peek('list').data).toEqual(['saved']);
    expect(cache.peek('list').refreshing).toBe(true);
    work.reject(new Error('offline'));
    await expect(read).rejects.toThrow('offline');
    expect(cache.peek('list').data).toEqual(['saved']);
    expect(cache.peek('list').refreshing).toBe(false);
    await expect(cache.read('list', async () => ['new'])).resolves.toEqual(['new']);
  });

  test('invalidation rejects late data and queues only one fresh request', async () => {
    const { cache } = setup();
    const old = deferred();
    const first = cache.read('account', () => old.promise);
    await Promise.resolve(); // IPC has started and cannot be cancelled
    const rejected = first.catch((error) => error);
    cache.invalidate('account', true);
    let calls = 0;
    const loader = async () => { calls++; return 'current'; };
    const reads = Array.from({ length: 50 }, () => cache.read('account', loader));
    old.resolve('removed account');
    expect(await rejected).toBeInstanceOf(CacheInvalidatedError);
    expect(await Promise.all(reads)).toEqual(Array(50).fill('current'));
    expect(calls).toBe(1);
    expect(cache.peek('account').data).toBe('current');
    expect(cache.metrics.discarded).toBe(1);
  });

  test('a second invalidation retires queued loaders as well as running work', async () => {
    const { cache } = setup();
    const old = deferred();
    const first = cache.read('x', () => old.promise).catch((error) => error);
    await Promise.resolve();
    cache.invalidate('x');
    let outdatedLoads = 0;
    const queued = cache.read('x', async () => { outdatedLoads++; return 'outdated'; }).catch((error) => error);
    cache.invalidate('x');
    const current = cache.read('x', async () => 'current');
    old.resolve('old');
    expect(await first).toBeInstanceOf(CacheInvalidatedError);
    expect(await queued).toBeInstanceOf(CacheInvalidatedError);
    expect(await current).toBe('current');
    expect(outdatedLoads).toBe(0);
  });

  test('a seed is not overwritten by older IPC', async () => {
    const { cache } = setup();
    const old = deferred();
    const read = cache.read('x', () => old.promise);
    await Promise.resolve();
    const rejected = read.catch((error) => error);
    cache.seed('x', 'seed');
    expect(await cache.read('x', async () => 'wrong')).toBe('seed');
    old.resolve('old');
    expect(await rejected).toBeInstanceOf(CacheInvalidatedError);
    expect(cache.peek('x').data).toBe('seed');
  });

  test('different keys stay isolated and inactive entries evict in LRU order', async () => {
    const { cache, advance } = setup();
    await cache.read('a', async () => 'a');
    advance(1);
    await cache.read('b', async () => 'b');
    advance(1);
    await cache.read('a', async () => 'wrong');
    await cache.read('c', async () => 'c');
    expect(cache.peek('a').data).toBe('a');
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.metrics.evictions).toBe(1);
  });

  test('active subscriptions are pinned and disposed subscriptions release capacity', async () => {
    const { cache } = setup({ maxEntries: 1 });
    const values = [];
    const stop = cache.subscribe('a', (snapshot) => values.push(snapshot.data));
    cache.seed('a', 'ready');
    expect(() => cache.seed('b', 'b')).toThrow('budget');
    stop();
    cache.seed('a', 'later');
    expect(values).toEqual([undefined, 'ready']);
    cache.seed('b', 'b');
    expect(cache.peek('a')).toBeUndefined();
  });

  test('reentrant invalidation cannot deliver an old snapshot after the new one', () => {
    const { cache } = setup();
    const received = [];
    const stopA = cache.subscribe('x', (snapshot) => {
      if (snapshot.data === 'old') cache.seed('x', 'new');
    });
    const stopB = cache.subscribe('x', (snapshot) => received.push(snapshot.data));
    cache.seed('x', 'old');
    expect(received).toEqual([undefined, 'new']);
    stopA();
    stopB();
  });

  test('in-flight entries are pinned and retention expires idle results', async () => {
    const { cache, advance } = setup({ maxEntries: 1 });
    const work = deferred();
    const read = cache.read('a', () => work.promise);
    advance(101);
    expect(() => cache.seed('b', 'b')).toThrow('budget');
    work.resolve('a');
    await read;
    advance(101);
    cache.seed('b', 'b');
    expect(cache.peek('a')).toBeUndefined();
  });

  test('synchronous errors are retryable and forgetting clears retained data', async () => {
    const { cache } = setup();
    await expect(cache.read('a', () => { throw new Error('broken'); })).rejects.toThrow('broken');
    await cache.read('a', async () => 'ok');
    cache.invalidateAll(true);
    expect(cache.peek('a').hasData).toBe(false);
    expect(cache.peek('a').data).toBeUndefined();
  });
});

// Window-creation snapshots are cheap, but replaying one after reload is incorrect.
import { takeAccountBootstrap } from '../src/features/accounts/account-bootstrap.ts';
test('startup account snapshot is consumed once, including an empty account list', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const snapshot = { snapshot_id: 'window-one', account_summaries: [] };
  expect(takeAccountBootstrap(snapshot, storage)).toEqual([]);
  expect(takeAccountBootstrap(snapshot, storage)).toBeUndefined();
  expect(takeAccountBootstrap({ ...snapshot, snapshot_id: 'window-two' }, storage)).toEqual([]);
  expect(takeAccountBootstrap(snapshot, { getItem() { throw new Error('denied'); }, setItem() {} })).toBeUndefined();
});
