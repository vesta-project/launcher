import { settleReactive, waitForReactive } from './async-conditions.js';
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let builtHarness;
const harness = () => (builtHarness ??= buildHarness());

test('reauthentication retires account-scoped cache and activity without reactive diagnostics', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    const id = 'reauthentication';
    let reads = 0;
    const resource = check.serverResource('private-data', async () => ++reads);
    const snapshot = { connection: { id, authRevision: 'old' }, state: { phase: 'online', access: 'paired' }, status: null };
    check.putSnapshot(snapshot);
    expect(await check.readServerResource(id, resource)).toBe(1);
    check.putOperations(id, [{ operationId: 'old', state: 'succeeded', createdAtMs: 1, updatedAtMs: 1, reconciling: false }]);
    check.putSnapshot({ ...snapshot, connection: { id, authRevision: 'new' } });
    check.flush();
    expect(await check.readServerResource(id, resource)).toBe(2);
    expect(check.untrack(() => check.serverOperations(id))).toEqual([]);
    await check.removeServer(id);
  }, { scenario: 'reauthentication-cache-isolation' });
  check.expectNoDiagnostics(artifact);
});

test('catalogue warmup and mounted readers share one load without reactive diagnostics', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    let reads = 0;
    const catalogue = check.serverResource('software-versions', async () => { reads++; return ['1.21.4']; }, 300_000);
    await Promise.all(Array.from({ length: 20 }, () => check.readServerResource('catalogue-warmup', catalogue, 'paper')));
    await check.readServerResource('catalogue-warmup', catalogue, 'paper');
    expect(reads).toBe(1);
    await check.removeServer('catalogue-warmup');
  }, { scenario: 'catalogue-prefetch-read-sharing' });
  check.expectNoDiagnostics(artifact);
});

test('one shared roster follows equal-count replacements and refuses stale/offline names', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    const id = 'roster-owner';
    const snapshot = { connection: { id }, state: { phase: 'online', access: 'paired' }, status: { state: 'running', generation: 'g1', playerCount: 1 } };
    check.putSnapshot(snapshot);
    check.flush();
    const owner = check.createRoot(dispose => ({ dispose, first: check.useServerRoster(() => check.serverSnapshot(id)), second: check.useServerRoster(() => check.serverSnapshot(id)) }));
    const opened = check.counts.opened;
    const value = (view) => check.untrack(view.value);
    try {
      check.putPlayers(id, { known: true, generation: 'g1', playerCount: 1, names: ['Alex'] });
      check.flush();
      expect(value(owner.first).names).toEqual(['Alex']);
      check.putPlayers(id, { known: true, generation: 'g1', playerCount: 1, names: ['Steve'] });
      check.flush();
      expect(value(owner.first).names).toEqual(['Steve']);
      expect(value(owner.second).names).toEqual(['Steve']);
      expect(check.counts.opened).toBe(opened);
      check.putSnapshot({ ...snapshot, status: { ...snapshot.status, generation: 'g2' } });
      check.flush();
      check.putPlayers(id, { known: true, generation: 'g1', playerCount: 1, names: ['Late'] });
      check.flush();
      expect(value(owner.first)).toEqual({ known: false });
      check.putPlayers(id, { known: true, generation: 'g2', playerCount: 1, names: ['New'] });
      check.putSnapshot({ ...snapshot, state: { phase: 'unreachable', access: 'paired' } });
      check.flush();
      check.putPlayers(id, { known: true, generation: 'g1', playerCount: 1, names: ['Late'] });
      check.flush();
      expect(value(owner.first)).toEqual({ known: false });
    } finally { owner.dispose(); await check.removeServer(id); }
  }, { scenario: 'one-roster-owner-and-generation-isolation' });
  check.expectNoDiagnostics(artifact);
});

test('moderation completion retires list caches once, rather than only at acceptance', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    const id = 'moderation-completion';
    let reads = 0;
    const list = check.serverResource('whitelist', async () => ++reads);
    const operation = { operationId: 'mod1', kind: 'players.moderate', state: 'queued', createdAtMs: 1, updatedAtMs: 1, reconciling: false };
    try {
      expect(await check.readServerResource(id, list)).toBe(1);
      check.putOperations(id, [operation]);
      expect(await check.readServerResource(id, list)).toBe(1);
      check.putOperations(id, [{ ...operation, state: 'succeeded', updatedAtMs: 2 }]);
      expect(await check.readServerResource(id, list)).toBe(2);
      check.putOperations(id, [operation]);
      check.putOperations(id, [{ ...operation, state: 'succeeded', updatedAtMs: 2 }]);
      expect(await check.readServerResource(id, list)).toBe(2);
      expect(reads).toBe(2);
    } finally { await check.removeServer(id); }
  }, { scenario: 'moderation-list-invalidation-once-after-completion' });
  check.expectNoDiagnostics(artifact);
});

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
      build.onLoad({ filter: /features[\\/]accounts[\\/]accounts\.ts$/ }, () => ({ loader: 'js', contents: `
        import { createSignal } from 'solid-js';
        const [activeAccount, setActiveAccount] = createSignal({ uuid: 'account-one' });
        export { activeAccount, setActiveAccount };
      ` }));
      build.onLoad({ filter: /features[\\/]servers[\\/]service\.ts$/ }, () => ({ loader: 'js', contents: `
        export const counts = { opened: 0, closed: 0 };
        export const replies = [];
        export const refreshCalls = [];
        export const listReplies = [];
        const api = { list: async () => listReplies.shift()?.() ?? [], onChanged: () => () => {}, subscribe: async () => { counts.opened++; return () => counts.closed++; }, snapshot: (id, refresh, background) => { refreshCalls.push({ id, refresh, ...(background ? { background } : {}) }); return new Promise((resolve, reject) => replies.push({ resolve, reject })); }, remove: async () => {} };
        export const serversApi = async () => api;
      ` }));
      build.onResolve({ filter: /^vesta-server-reactivity-check$/ }, () => ({ path: 'check', namespace: 'server-check' }));
      build.onLoad({ filter: /.*/, namespace: 'server-check' }, () => ({ loader: 'js', resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
        import { createEffect, createMemo, createRoot, createSignal, flush, untrack } from 'solid-js';
        import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
        import { stableConnectionId } from ${JSON.stringify(connectionIdPath)};
        import { createServerRead, readRetryDelay } from ${JSON.stringify(readStatePath)};
        export { createRoot, createEffect, createMemo, createSignal, flush, untrack, createServerRead, readRetryDelay };
        export { ConsoleBuffer, clearConsoleDisplay, consoleDisplayBoundary } from ${JSON.stringify(fileURLToPath(new URL('../src/features/servers/console-model.ts', import.meta.url)))};
        export { serverConsoleView, toLogEntries } from ${JSON.stringify(fileURLToPath(new URL('../src/features/servers/console-view.ts', import.meta.url)))};
        import { useServerTopic } from ${JSON.stringify(storePath)};
        export { refreshServer, refreshServers, serverRefreshing, putSnapshot, serverSnapshot, removeServer, putPlayers, serverPlayers, useServerRoster, putOperations, serverOperations, serverCommand, useServerSync, useServerStatusSync } from ${JSON.stringify(storePath)};
        export { setActiveAccount } from ${JSON.stringify(fileURLToPath(new URL('../src/features/accounts/accounts.ts', import.meta.url)))};
        export { serverResource, readServerResource, useServerResource, applyResourceChanges, resourceEditor } from ${JSON.stringify(fileURLToPath(new URL('../src/features/servers/resources.ts', import.meta.url)))};
        import { counts } from ${JSON.stringify(servicePath)};
        export { counts, replies, refreshCalls, listReplies } from ${JSON.stringify(servicePath)};
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

test('a delayed saved list cannot roll a newer server observation back', async () => {
  const check = await harness();
  const id = 'stale-server-list';
  const offline = { connection: { id }, state: { phase: 'unreachable', access: 'paired' }, status: null };
  const online = { ...offline, state: { ...offline.state, phase: 'online' }, status: { state: 'running' } };
  let resolve;
  const reply = new Promise(done => { resolve = done; });
  try {
    check.putSnapshot(offline);
    check.flush();
    check.listReplies.push(() => reply);
    const refresh = check.refreshServers();
    await settleReactive(check);
    check.putSnapshot(online);
    check.flush();
    resolve([offline]);
    await refresh;
    check.flush();
    expect(check.untrack(() => check.serverSnapshot(id))).toEqual(online);
  } finally { await check.removeServer(id); check.flush(); }
});

test('grid status refreshes before opening a server and leaves the open workspace to its live stream', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `grid-status-${i}`);
    const disconnected = (id) => ({ connection: { id }, state: { phase: 'disconnected', access: 'paired' }, status: null });
    const online = (id) => ({ ...disconnected(id), state: { phase: 'online', access: 'paired' }, status: { state: 'running' } });
    for (const id of ids) check.putSnapshot(disconnected(id));
    check.flush();
    const callsAt = check.refreshCalls.length;
    const subscriptions = check.counts.opened;
    const owner = check.createRoot(dispose => {
      const [showList, setShowList] = check.createSignal(true, { name: 'card-status-test:list' });
      const [workspace, setWorkspace] = check.createSignal(undefined, { name: 'card-status-test:workspace' });
      check.useServerStatusSync(showList, workspace);
      return { dispose, setShowList, setWorkspace };
    });
    const read = id => check.untrack(() => check.serverSnapshot(id));
    try {
      await waitForReactive(check, () => check.replies.length === 4, 'four concurrent card requests');
      expect(check.refreshCalls.slice(callsAt)).toEqual(ids.slice(0, 4).map(id => ({ id, refresh: true, background: true })));
      expect(check.counts.opened).toBe(subscriptions);
      check.replies.shift().resolve(online(ids[0]));
      await waitForReactive(check, () => read(ids[0])?.state.phase === 'online' && check.refreshCalls.length === callsAt + 5, 'grid status and fifth request');
      expect(read(ids[0]).status.state).toBe('running');

      // Opening a card keeps the same value and stops grid demand for other unpinned servers.
      owner.setShowList(false);
      owner.setWorkspace(ids[0]);
      check.flush();
      expect(read(ids[0])).toEqual(online(ids[0]));
      for (const id of ids.slice(1, 5)) check.replies.shift().resolve(online(id));
      await settleReactive(check);
      expect(check.refreshCalls.length).toBe(callsAt + 5);
      expect(read(ids[5]).state.phase).toBe('disconnected');
    } finally {
      owner.dispose();
      for (const id of ids) await check.removeServer(id);
      check.flush();
    }
  }, { scenario: 'bounded-card-status-before-navigation' });
  check.expectNoDiagnostics(artifact);
});

test('card polling observes later game changes and respects the status retry deadline', async () => {
  const check = await harness();
  const id = 'card-status-retry';
  const running = { connection: { id }, state: { phase: 'online', access: 'paired' }, status: { state: 'running' } };
  const stopped = { ...running, status: { state: 'stopped' } };
  const originalNow = Date.now;
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  let now = originalNow();
  let pulse;
  const timer = Symbol('card polling');
  Date.now = () => now;
  globalThis.setInterval = (callback, delay, ...args) => {
    if (delay !== 1000) return originalSet(callback, delay, ...args);
    pulse = callback;
    return timer;
  };
  globalThis.clearInterval = (handle) => {
    if (handle === timer) pulse = undefined;
    else originalClear(handle);
  };
  check.putSnapshot(running);
  check.flush();
  const owner = check.createRoot(dispose => { check.useServerStatusSync(() => true, () => undefined); return { dispose }; });
  const tick = async (advance) => { now += advance; pulse(); await settleReactive(check); };
  try {
    await waitForReactive(check, () => check.replies.length === 1, 'initial card status read');
    check.replies.shift().reject({ code: 'rate_limited', retryAfterMs: 25_000 });
    await settleReactive(check);
    await tick(10_000);
    expect(check.replies).toHaveLength(0);
    await tick(15_000);
    expect(check.replies).toHaveLength(1);
    check.replies.shift().resolve(stopped);
    await waitForReactive(check, () => check.untrack(() => check.serverSnapshot(id))?.status?.state === 'stopped', 'new Minecraft state in the grid');
    owner.dispose();
    expect(pulse).toBeUndefined();
  } finally {
    owner.dispose();
    Date.now = originalNow;
    globalThis.setInterval = originalSet;
    globalThis.clearInterval = originalClear;
    await check.removeServer(id);
    check.flush();
  }
});

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

test('console batches publish once and clear survives reactive history recovery', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(() => {
    let runs = 0;
    const owner = check.createRoot(dispose => {
      const buffer = new check.ConsoleBuffer(5000);
      const [version, setVersion] = check.createSignal(0, { name: 'console-check:version' });
      const [state, patch] = check.serverConsoleView('console-diagnostics');
      const parsed = new WeakMap();
      const rows = check.createMemo(() => {
        version(); runs++;
        return check.toLogEntries(buffer.entries, { label: 'gap' }, parsed);
      }, { name: 'console-check:rows' });
      const visible = check.createMemo(() => {
        const values = rows();
        const boundary = check.consoleDisplayBoundary(buffer.entries, state());
        return { values, boundary };
      }, { name: 'console-check:visible' });
      return { dispose, buffer, patch, visible, setVersion };
    });
    const lines = (start, count) => Array.from({ length: count }, (_, i) => ({
      cursor: `fixture.console.${start + i}`, text: `line ${start + i}`, truncated: false,
    }));
    const publish = () => { owner.setVersion(n => n + 1); check.flush(); };
    const visible = () => {
      const { values, boundary } = check.untrack(owner.visible);
      return values.filter(row => row.id >= boundary);
    };
    try {
      check.flush(); visible();
      for (let batch = 0; batch < 64; batch++) {
        owner.buffer.append(lines(1000 + batch * 64, 64)); publish(); visible();
      }
      expect(runs).toBe(65);
      owner.patch(check.clearConsoleDisplay(owner.buffer.entries)); check.flush();
      expect(visible()).toEqual([]);
      owner.buffer.merge(lines(998, 10)); publish();
      expect(visible()).toEqual([]);
      owner.buffer.append(lines(5096, 2)); publish();
      expect(visible().map(row => row.raw)).toEqual(['line 5096', 'line 5097']);
    } finally { owner.dispose(); }
  }, { scenario: 'console-batch-recovery-and-clear-display' });
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

test('account switches reject in-flight data and close late subscriptions', async () => {
  const check = await harness();
  let resolve;
  const pending = check.serverCommand(() => new Promise(done => { resolve = done; }));
  const outcome = pending.catch(error => error);
  await Promise.resolve(); await Promise.resolve();
  check.setActiveAccount({ uuid: 'account-two' });
  resolve({ privileged: true });
  expect(await outcome).toMatchObject({ code: 'credentials_rejected' });

  let closed = 0;
  const subscription = check.serverCommand(() => new Promise(done => { resolve = done; }));
  const subscriptionOutcome = subscription.catch(error => error);
  await Promise.resolve(); await Promise.resolve();
  check.setActiveAccount({ uuid: 'account-three' });
  resolve(() => { closed++; });
  expect(await subscriptionOutcome).toMatchObject({ code: 'credentials_rejected' });
  expect(closed).toBe(1);
  check.setActiveAccount({ uuid: 'account-one' });
});

test('account switches immediately discard cached privileged server content', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    const owner = check.createRoot(dispose => { check.useServerSync(); return { dispose }; });
    try {
      check.flush(); await Promise.resolve(); await Promise.resolve(); check.flush();
      const id = 'account-switch-server';
      check.putSnapshot({ connection: { id, authRevision: 'owner' }, state: { phase: 'online', access: 'paired' }, status: null });
      check.putOperations(id, [{ operationId: 'private-op', state: 'queued' }]);
      check.flush();
      expect(check.untrack(() => check.serverSnapshot(id))).toBeDefined();
      check.setActiveAccount({ uuid: 'account-two' }); check.flush();
      expect(check.untrack(() => check.serverSnapshot(id))).toBeUndefined();
      expect(check.untrack(() => check.serverOperations(id))).toEqual([]);
      await Promise.resolve(); await Promise.resolve(); check.flush();
    } finally { owner.dispose(); check.setActiveAccount({ uuid: 'account-one' }); check.flush(); }
  }, { scenario: 'server-cache-account-isolation' });
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
    const settle = () => settleReactive(check);
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
      pending[1].resolve('new result'); await waitForReactive(check, () => state().value === 'new result', 'latest read response');
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


test('resource change hints refresh mounted reads once, preserving local drafts until explicit review', async () => {
  const check = await harness();
  const { EditRevision } = await import('../src/features/servers/edit-revision.ts');
  const { artifact } = await check.captureArtifact(async () => {
    let reads = 0;
    let saved = { revision: '1', name: 'Old', description: 'Old description' };
    const id = 'live-resource-changes';
    const def = check.serverResource('branding', async () => { reads++; return saved; });
    const owner = check.createRoot(dispose => ({ dispose, resource: check.useServerResource(() => id, def) }));
    const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); check.flush(); } };
    try {
      check.flush(); await settle();
      const guard = new EditRevision(); guard.begin('1');
      const draft = { name: 'My draft' };
      saved = { revision: '2', name: 'Other admin', description: 'New description' };
      const changes = { branding: { revision: '7', display_name: 'Another admin', at_ms: 100 } };
      check.applyResourceChanges(id, changes); check.flush(); await settle();
      expect(reads).toBe(2);
      const current = check.untrack(owner.resource.value);
      expect({ ...current, ...draft }).toMatchObject({ name: 'My draft', description: 'New description' });
      expect(guard.conflicts(current.revision)).toBe(true);
      expect(check.untrack(() => check.resourceEditor(id, 'branding'))).toEqual(changes.branding);
      check.applyResourceChanges(id, changes); check.flush(); await settle();
      expect(reads).toBe(2);
      guard.review(current.revision); expect(guard.conflicts(current.revision)).toBe(false);
    } finally { owner.dispose(); await check.removeServer(id); }
  }, { scenario: 'cross-admin-live-resource-refresh' });
  check.expectNoDiagnostics(artifact);
});


test('silent equal refresh keeps data and unchanged row identities', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    let resolve;
    const id = 'silent-refresh';
    const def = check.serverResource('stable-list', () => new Promise(done => { resolve = done; }));
    let runs = 0;
    const owner = check.createRoot(dispose => {
      const resource = check.useServerResource(() => id, def);
      check.createEffect(resource.value, () => { runs++; }, { name: 'silentRefreshConsumer' });
      return { dispose, resource };
    });
    const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); check.flush(); } };
    const value = () => check.untrack(owner.resource.value);
    try {
      check.flush(); await settle();
      resolve([{ id: 'a', count: 1 }, { id: 'b', count: 2 }]); await settle();
      const initial = value();
      const initialRuns = runs;
      const refresh = owner.resource.refresh(); await settle();
      expect(value()).toBe(initial);
      expect(check.untrack(owner.resource.loading)).toBe(false);
      resolve([{ id: 'a', count: 1 }, { id: 'b', count: 2 }]); await refresh; await settle();
      expect(value()).toBe(initial);
      expect(runs).toBe(initialRuns);
      const changed = owner.resource.refresh(); await settle();
      resolve([{ id: 'a', count: 3 }, { id: 'b', count: 2 }]); await changed; await settle();
      expect(value()[0].count).toBe(3);
      expect(value()[1]).toBe(initial[1]);
    } finally { owner.dispose(); await check.removeServer(id); }
  }, { scenario: 'silent-stale-resource-refresh' });
  check.expectNoDiagnostics(artifact);
});
