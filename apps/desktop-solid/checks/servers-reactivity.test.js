import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let builtHarness;
const harness = () => (builtHarness ??= buildHarness());

test('manual server refresh coalesces across views and never resurrects a removed connection', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    const id = 'manual-refresh';
    const snapshot = { connection: { id }, state: { phase: 'unreachable' } };
    check.putSnapshot(snapshot);
    check.flush();
    const first = check.refreshServer(id);
    expect(check.refreshServer(id)).toBe(first);
    check.flush();
    expect(check.untrack(() => check.serverRefreshing(id))).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    expect(check.refreshCalls).toEqual([{ id, refresh: true }]);
    check.replies.shift().resolve({ ...snapshot, state: { phase: 'online' } });
    await first;
    check.flush();
    expect(check.untrack(() => check.serverSnapshot(id)).state.phase).toBe('online');
    expect(check.untrack(() => check.serverRefreshing(id))).toBe(false);
    const second = check.refreshServer(id);
    const outcome = second.then(() => null, (reason) => reason);
    await Promise.resolve(); await Promise.resolve();
    check.replies.shift().reject({ code: 'unreachable' });
    expect(await outcome).toMatchObject({ code: 'unreachable' });
    check.flush();
    expect(check.untrack(() => check.serverRefreshing(id))).toBe(false);
    const third = check.refreshServer(id);
    await Promise.resolve(); await Promise.resolve();
    await check.removeServer(id);
    check.flush();
    check.replies.shift().resolve(snapshot);
    await third;
    check.flush();
    expect(check.untrack(() => check.serverSnapshot(id))).toBeUndefined();
  }, { scenario: 'explicit-server-refresh-single-flight' });
  check.expectNoDiagnostics(artifact);
});

async function buildHarness() {
  const connectionIdPath = fileURLToPath(new URL('../src/features/servers/connection-id.ts', import.meta.url));
  const readStatePath = fileURLToPath(new URL('../src/features/servers/read-state.ts', import.meta.url));
  const storePath = fileURLToPath(new URL('../src/features/servers/store.ts', import.meta.url));
  const servicePath = fileURLToPath(new URL('../src/features/servers/service.ts', import.meta.url));
  const built = await Bun.build({
    entrypoints: ['vesta-server-reactivity-check'], target: 'bun', conditions: ['browser', 'development'],
    plugins: [{ name: 'server-reactivity-check', setup(build) {
      build.onLoad({ filter: /features[\\/]servers[\\/]service\.ts$/ }, () => ({ loader: 'js', contents: `
        export const counts = { opened: 0, closed: 0 };
        export const replies = [];
        export const refreshCalls = [];
        const api = { subscribe: async () => { counts.opened++; return () => counts.closed++; }, snapshot: (id, refresh) => { refreshCalls.push({ id, refresh }); return new Promise((resolve, reject) => replies.push({ resolve, reject })); }, remove: async () => {} };
        export const serversApi = async () => api;
      ` }));
      build.onResolve({ filter: /^vesta-server-reactivity-check$/ }, () => ({ path: 'check', namespace: 'server-check' }));
      build.onLoad({ filter: /.*/, namespace: 'server-check' }, () => ({ loader: 'js', resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
        import { createEffect, createRoot, createSignal, flush, untrack } from 'solid-js';
        import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
        import { stableConnectionId } from ${JSON.stringify(connectionIdPath)};
        import { createServerRead, readRetryDelay } from ${JSON.stringify(readStatePath)};
        export { createRoot, createSignal, flush, untrack, createServerRead, readRetryDelay };
        import { useServerTopic } from ${JSON.stringify(storePath)};
        export { refreshServer, serverRefreshing, putSnapshot, serverSnapshot, removeServer } from ${JSON.stringify(storePath)};
        import { counts } from ${JSON.stringify(servicePath)};
        export { counts, replies, refreshCalls } from ${JSON.stringify(servicePath)};
        export { captureArtifact, expectNoDiagnostics };
        export function scenario(assert) {
          const owner = createRoot(dispose => {
            const [snapshot, setSnapshot] = createSignal({ connection: { id: 'one' }, observation: 0 }, { name: 'server-check:snapshot' });
            const id = stableConnectionId(snapshot);
            let loads = 0, draft = false, error = null;
            createEffect(id, () => { loads++; draft = false; error = null; }, { name: 'server-check:load-policy' });
            return { dispose, setSnapshot, edit: () => { draft = true; error = 'rate_limited'; }, state: () => ({ loads, draft, error }) };
          });
          try {
            flush(); owner.edit();
            for (let observation = 1; observation <= 60; observation++) {
              owner.setSnapshot({ connection: { id: 'one' }, observation }); flush();
            }
            assert(owner.state(), 'same-server');
            owner.setSnapshot({ connection: { id: 'two' }, observation: 61 }); flush();
            assert(owner.state(), 'different-server');
          } finally { owner.dispose(); }
        }
        export async function topicScenario(assert) {
          const owner = createRoot(dispose => {
            const [snapshot, setSnapshot] = createSignal({ connection: { id: 'one' }, observation: 0 }, { name: 'server-check:topic-snapshot' });
            useServerTopic(() => snapshot().connection.id, 'status');
            return { dispose, setSnapshot };
          });
          const settle = async () => { flush(); await new Promise(resolve => setTimeout(resolve, 0)); flush(); };
          try {
            await settle();
            for (let observation = 1; observation <= 60; observation++) {
              owner.setSnapshot({ connection: { id: 'one' }, observation }); flush();
            }
            await settle(); assert({ ...counts }, 'same-server');
            owner.setSnapshot({ connection: { id: 'two' }, observation: 61 });
            await settle(); assert({ ...counts }, 'different-server');
          } finally { owner.dispose(); }
          assert({ ...counts }, 'disposed');
        }
      ` }));
    } }],
  });
  if (!built.success) throw new AggregateError(built.logs);
  const dir = await mkdtemp(join(tmpdir(), 'vesta-server-reactivity-'));
  try {
    const path = join(dir, 'check.mjs');
    await Bun.write(path, built.outputs[0]);
    return await import(pathToFileURL(path).href);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('live status updates preserve sleep drafts and errors without refetching policy', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(() => {
    check.scenario((state, phase) => {
      expect(state).toEqual(phase === 'same-server'
        ? { loads: 1, draft: true, error: 'rate_limited' }
        : { loads: 2, draft: false, error: null });
    });
  }, { scenario: 'server-settings-draft-during-live-status' });
  check.expectNoDiagnostics(artifact);
});

test('live snapshots do not reconnect subscriptions until server identity changes', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    await check.topicScenario((counts, phase) => {
      expect(counts).toEqual(phase === 'same-server' ? { opened: 1, closed: 0 }
        : phase === 'different-server' ? { opened: 2, closed: 1 } : { opened: 2, closed: 2 });
    });
  }, { scenario: 'server-subscriptions-during-live-status' });
  check.expectNoDiagnostics(artifact);
});

test('read state keeps the latest response and ignores disposed completions', async () => {
  const check = await harness();
  const pending = [];
  const { artifact } = await check.captureArtifact(async () => {
    const owner = check.createRoot(dispose => {
      const [snapshot, setSnapshot] = check.createSignal({ id: 'one', observation: 0 });
      const read = check.createServerRead({ key: () => snapshot().id, name: 'check-read',
        read: (key, signal) => new Promise((resolve, reject) => pending.push({ key, signal, resolve, reject })) });
      return { dispose, setSnapshot, read };
    });
    const settle = async () => { await Promise.resolve(); check.flush(); };
    const state = () => check.untrack(() => ({ value: owner.read.value(), error: owner.read.error() }));
    try {
      check.flush();
      for (let observation = 1; observation <= 60; observation++) {
        owner.setSnapshot({ id: 'one', observation }); check.flush();
      }
      expect(pending.length).toBe(1);
      owner.setSnapshot({ id: 'two', observation: 61 }); check.flush();
      expect(pending.map(item => item.key)).toEqual(['one', 'two']);
      expect(pending[0].signal.aborted).toBe(true);
      pending[1].resolve('new result'); await settle();
      pending[0].reject({ code: 'unreachable' }); await settle();
      expect(state()).toEqual({ value: 'new result', error: null });
      const refresh = owner.read.refresh();
      owner.dispose();
      expect(pending[2].signal.aborted).toBe(true);
      pending[2].resolve('disposed result'); await refresh; await settle();
      expect(state()).toEqual({ value: 'new result', error: null });
    } finally { owner.dispose(); }
  }, { scenario: 'server-read-out-of-order-and-disposal' });
  check.expectNoDiagnostics(artifact);
});

test('read polling recovers from transient failure and honors cooldown without hiding errors', async () => {
  const check = await harness();
  const timers = new Map();
  const pending = [];
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  let nextTimer = 0;
  globalThis.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  try {
    const { artifact } = await check.captureArtifact(async () => {
      const owner = check.createRoot(dispose => ({ dispose, read: check.createServerRead({
        key: () => 'server:history', name: 'check-poll', retry: true,
        read: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
        pollAfter: value => value === 'running' ? 5000 : null,
      }) }));
      const settle = async () => { await Promise.resolve(); check.flush(); };
      const fire = () => { const [id, timer] = [...timers][0]; timers.delete(id); timer.callback(); };
      const state = () => check.untrack(() => ({ value: owner.read.value(), error: owner.read.error() }));
      try {
        check.flush(); pending[0].resolve('running'); await settle();
        expect([...timers.values()][0].delay).toBe(5000);
        fire(); pending[1].reject({ code: 'rate_limited', retryAfterMs: 30_000 }); await settle();
        expect(state()).toEqual({ value: 'running', error: { code: 'rate_limited', retryAfterMs: 30_000 } });
        expect(timers.size).toBe(1);
        expect([...timers.values()][0].delay).toBeGreaterThanOrEqual(30_000);
        fire(); expect(state().error.code).toBe('rate_limited');
        pending[2].resolve('done'); await settle();
        expect(state()).toEqual({ value: 'done', error: null });
        expect(timers.size).toBe(0);
        const refresh = owner.read.refresh();
        pending[3].reject({ code: 'credentials_rejected' }); await refresh;
        expect(timers.size).toBe(0);
      } finally { owner.dispose(); }
    }, { scenario: 'server-read-transient-recovery' });
    check.expectNoDiagnostics(artifact);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
