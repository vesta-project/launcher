import { describe, expect, test } from 'bun:test';
import { capabilitiesForRole } from '../src/features/servers/capabilities';
import {
  agentReachable, backupsConfigured, extraWarnings, headerExplains, headerNotice, isQuietError, joinAddress, knownPlayerCount,
  legacyTabs, paneState, resolveServerLocation, restartPending, serverPath, visibleMainTabs, visibleSections,
} from '../src/features/servers/shell-model';
import {
  invalidateServerResources, peekServerResource, readServerResource, resourceKey, seedServerResource, serverResource,
} from '../src/features/servers/resources';

const status = (patch = {}) => ({
  state: 'running', lifecycle: 'online', generation: 'g'.repeat(32), playerCount: 2, playerCountKnown: true,
  playerCountObservedAtMs: 1_000, uptimeSeconds: '3700', readiness: 'ready', readinessReason: null,
  readinessEvidence: 'log_and_probe', supervision: 'separate', supervisor: null, ...patch,
});
const snapshot = (patch = {}, role = 'owner') => ({
  connection: { id: 'c1', name: 'Test', endpoint: 'agent.example:8443', serverId: 's', fingerprint: 'f', role, signInMethod: 'pairing_code', memoryOnly: false, pinned: false, addedAtMs: 0, lastConnectedAtMs: 0 },
  state: { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
  info: null, status: status(), statusObservedAtMs: 0, pack: null,
  capabilities: { source: 'session', granted: capabilitiesForRole(role), refused: [] },
  restartRequired: false,
  ...patch,
});
const offline = (phase = 'unreachable') => snapshot({ state: { phase, access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: 'unreachable' } });

describe('[shell] routing', () => {
  test('main tabs, settings sections and the overview default', () => {
    expect(resolveServerLocation(undefined, undefined)).toEqual({ mode: 'main', tab: 'overview' });
    expect(resolveServerLocation('console', undefined)).toEqual({ mode: 'main', tab: 'console' });
    expect(resolveServerLocation('files', 'world')).toEqual({ mode: 'main', tab: 'files' });
    expect(resolveServerLocation('settings', 'access')).toEqual({ mode: 'settings', section: 'access' });
    expect(resolveServerLocation('nonsense', undefined)).toEqual({ mode: 'main', tab: 'overview' });
  });

  test('old tab ids redirect to their settings section', () => {
    expect(resolveServerLocation('players', undefined)).toEqual({ mode: 'settings', section: 'players', redirect: 'settings/players' });
    expect(resolveServerLocation('presence', undefined)).toMatchObject({ section: 'presence', redirect: 'settings/presence' });
    expect(resolveServerLocation('access', undefined)).toMatchObject({ section: 'access', redirect: 'settings/access' });
    expect(resolveServerLocation('connection', undefined)).toMatchObject({ section: 'connection', redirect: 'settings/connection' });
    // `/settings` was the server.properties tab.
    expect(resolveServerLocation('settings', undefined)).toMatchObject({ section: 'game', redirect: 'settings/game' });
    expect(resolveServerLocation('settings', 'bogus')).toMatchObject({ section: 'general', redirect: 'settings/general' });
    for (const id of Object.keys(legacyTabs)) expect(resolveServerLocation(id, undefined).redirect).toBeDefined();
  });

  test('paths round-trip', () => {
    expect(serverPath('c1', { mode: 'main', tab: 'overview' })).toBe('/servers/c1');
    expect(serverPath('c1', { mode: 'main', tab: 'activity' })).toBe('/servers/c1/activity');
    expect(serverPath('c1', { mode: 'settings', section: 'game' })).toBe('/servers/c1/settings/game');
    const [, , , detail, item] = serverPath('c1', { mode: 'settings', section: 'players' }).split('/');
    expect(resolveServerLocation(detail, item)).toEqual({ mode: 'settings', section: 'players' });
  });

  test('the main nav has no players, settings, access or connection tabs', () => {
    const ids = visibleMainTabs({ snapshot: snapshot(), backupsConfigured: true }).map((tab) => tab.id);
    expect(ids).toEqual(['overview', 'console', 'resources', 'pack', 'files', 'automation', 'backups', 'activity']);
  });

  test('backups show when set up, or while the user can set them up', () => {
    const ids = (configured, requested, role = 'maintainer') => visibleMainTabs({ snapshot: snapshot({}, role), backupsConfigured: configured, requested }).map((tab) => tab.id);
    expect(ids(false)).not.toContain('backups');
    expect(ids(undefined)).not.toContain('backups');
    // A deep link keeps the tab while the answer is still loading.
    expect(ids(undefined, 'backups')).toContain('backups');
    expect(ids(false, 'backups')).not.toContain('backups');
    // Owners keep the tab to set backups up.
    expect(ids(false, undefined, 'owner')).toContain('backups');
    expect(backupsConfigured(snapshot(), undefined)).toBeUndefined();
    expect(backupsConfigured(snapshot(), { profiles: [] })).toBe(false);
    expect(backupsConfigured(snapshot(), { profiles: [{}] })).toBe(true);
    expect(backupsConfigured({ ...snapshot(), backupsConfigured: false }, { profiles: [{}] })).toBe(false);
    expect(backupsConfigured(snapshot({}, 'viewer'), { profiles: [{}] })).toBe(false);
  });

  test('settings sections follow capabilities; connection is always there', () => {
    expect(visibleSections(snapshot()).map((section) => section.id)).toEqual(['general', 'game', 'world', 'software', 'sftp', 'presence', 'players', 'access', 'connection']);
    expect(visibleSections(snapshot({}, 'viewer')).map((section) => section.id)).toEqual(['players', 'connection']);
    expect(visibleSections(snapshot({}, 'pack-user')).map((section) => section.id)).toEqual(['connection']);
  });
});

describe('[shell] offline gating', () => {
  test('live panes wait for the agent; overview and connection never do', () => {
    expect(agentReachable(snapshot())).toBe(true);
    for (const phase of ['connecting', 'backoff', 'unreachable', 'disconnected']) {
      expect(paneState(offline(phase), { live: true })).toBe('offline');
      expect(paneState(offline(phase), { live: false })).toBe('ready');
    }
    expect(paneState(snapshot({ state: { phase: 'online', access: 'credentials_unavailable', retryAtMs: null, rateLimitedUntilMs: null, lastError: null } }), { live: true })).toBe('offline');
  });

  test('a stopped Minecraft does not gate panes that work while stopped', () => {
    expect(paneState(snapshot({ status: status({ state: 'stopped', generation: null }) }), { live: true })).toBe('ready');
  });

  test('player count shows only when observed for the running game', () => {
    expect(knownPlayerCount(snapshot())).toBe(2);
    expect(knownPlayerCount(snapshot({ status: status({ playerCount: 0 }) }))).toBe(0);
    expect(knownPlayerCount(snapshot({ status: status({ playerCountKnown: false, playerCount: null }) }))).toBeNull();
    expect(knownPlayerCount(snapshot({ status: status({ state: 'stopped' }) }))).toBeNull();
    expect(knownPlayerCount(offline())).toBeNull();
  });

  test('the join address is never the agent endpoint', () => {
    expect(joinAddress(snapshot())).toBeNull();
    expect(joinAddress({ ...snapshot(), joinAddress: ' play.example.net ' })).toBe('play.example.net');
  });
});

describe('[shell] one place for connectivity problems', () => {
  test('transport and capacity errors are quiet; actionable ones are not', () => {
    for (const code of ['unreachable', 'timeout', 'server_busy', 'rate_limited', 'outcome_unknown']) expect(isQuietError(code)).toBe(true);
    for (const code of ['forbidden', 'invalid_input', 'conflict', 'stale_target', 'not_found', 'internal']) expect(isQuietError(code)).toBe(false);
  });

  test('panels hide quiet errors only while the header explains them', () => {
    const busy = { code: 'server_busy' };
    expect(headerExplains(busy, offline(), null, 0)).toBe(true);
    expect(headerExplains({ ...busy, reason: 'content_provider_not_configured' }, offline(), null, 0)).toBe(false);
    expect(headerExplains({ ...busy, reason: 'content_pack_download_failed' }, offline(), null, 0)).toBe(false);
    expect(headerExplains(busy, snapshot(), { code: 'server_busy', untilMs: 10 }, 5)).toBe(true);
    expect(headerExplains(busy, snapshot(), { code: 'server_busy', untilMs: 10 }, 20)).toBe(false);
    expect(headerExplains(busy, snapshot(), null, 0)).toBe(false);
    expect(headerExplains({ code: 'forbidden' }, offline(), null, 0)).toBe(false);
  });

  test('the strip shows one notice, by priority', () => {
    const crash = snapshot({ status: status({ lifecycle: 'crash_loop' }), restartRequired: true });
    expect(headerNotice(crash, 0)?.kind).toBe('crash-loop');
    expect(headerNotice({ ...offline('backoff'), restartRequired: true }, 0)).toMatchObject({ kind: 'connection', action: 'retry' });
    expect(headerNotice(offline('connecting'), 0)).toMatchObject({ kind: 'connection', tone: 'neutral' });
    expect(headerNotice(snapshot(), 0, { code: 'server_busy', untilMs: 100 })).toMatchObject({ kind: 'pressure', title: { message: 'servers.error.server-busy' } });
    expect(headerNotice(snapshot({ status: status({ readinessReason: 'probe_failed' }) }), 0)?.kind).toBe('degraded');
    expect(headerNotice(snapshot(), 0)).toBeNull();
  });

  test('a pending restart is a notice with Restart now, gone once Minecraft stops', () => {
    expect(headerNotice(snapshot({ restartRequired: true }), 0)).toMatchObject({ kind: 'restart', action: 'restart' });
    expect(headerNotice(snapshot({ restartRequired: true }, 'moderator'), 0)).toMatchObject({ kind: 'restart', action: undefined });
    const stopped = snapshot({ restartRequired: true, status: status({ state: 'stopped', generation: null }) });
    expect(restartPending(stopped)).toBe(false);
    expect(headerNotice(stopped, 0)).toBeNull();
  });

  test('overview lists only warnings the strip is not already showing', () => {
    const supervisor = { orphanRunning: true, launchUnresolved: true, observationFailed: false, crashRestartEnabled: true, crashLoop: false, restartStateUnsaved: false, recentCrashes: 0, restartPendingMs: null };
    const value = snapshot({ status: status({ supervisor }) });
    expect(extraWarnings(value, headerNotice(value, 0))).toEqual(['servers.supervisor.launch-unresolved']);
  });
});

describe('[shell] resource cache', () => {
  test('keys separate connection, resource and arguments', () => {
    expect(resourceKey('c1', 'players', 'gen-a')).toBe('c1:players:"gen-a"');
    expect(resourceKey('c1', 'players')).toBe('c1:players:');
    expect(resourceKey('c1', 'players', 'gen-a')).not.toBe(resourceKey('c1', 'players', 'gen-b'));
    expect(resourceKey('c1', 'bans')).not.toBe(resourceKey('c2', 'bans'));
  });

  test('fresh reads are shared; invalidation is per connection and per name', async () => {
    let loads = 0;
    const counted = serverResource('shell-test-list', async (id) => { loads++; return `${id}:${loads}`; });
    const other = serverResource('shell-test-other', async () => 'other');
    const [first, second] = await Promise.all([readServerResource('k1', counted), readServerResource('k1', counted)]);
    expect(first).toBe(second);
    expect(loads).toBe(1);
    await readServerResource('k1', counted);
    expect(loads).toBe(1);
    await readServerResource('k2', counted);
    expect(loads).toBe(2);

    invalidateServerResources('k1', ['shell-test-other']);
    await readServerResource('k1', counted);
    expect(loads).toBe(2);

    invalidateServerResources('k1');
    // Invalidation keeps the shown value while it revalidates.
    expect(peekServerResource('k1', counted)).toBe('k1:1');
    await readServerResource('k1', counted);
    expect(loads).toBe(3);
    await readServerResource('k2', counted);
    expect(loads).toBe(3);

    seedServerResource('k3', other, 'seeded');
    expect(await readServerResource('k3', other)).toBe('seeded');
    invalidateServerResources('k3', undefined, true);
    expect(peekServerResource('k3', other)).toBeUndefined();
  });
});

// Use the browser Solid runtime so these checks exercise mounted reader ownership.
async function resourceHarness(run, initialPath = '/library') {
  const { mkdtemp, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const directory = await mkdtemp(join(tmpdir(), 'vesta-shell-'));
  const token = `shell${crypto.randomUUID().replaceAll('-', '')}`;
  const timers = new Map();
  const listeners = {};
  let sequence = 0;
  const c = {
    now: 1000, timers,
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: c.now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    location: { hash: `#${initialPath}` },
    window: { addEventListener: (event, callback) => { listeners[event] = callback; } },
    history: {
      state: { vesta: 2, from: '/servers' }, replacements: [], pushes: [],
      replaceState(state, _, url) { this.state = state; c.location.hash = url; this.replacements.push(url); },
      pushState(state, _, url) { this.state = state; c.location.hash = url; this.pushes.push(url); },
    },
    listeners,
  };
  globalThis[token] = c;
  try {
    const built = await Bun.build({
      entrypoints: ['shell-check'], target: 'bun', conditions: ['browser', 'development'],
      plugins: [{ name: 'shell-check', setup(build) {
        build.onResolve({ filter: /^shell-check$/ }, () => ({ path: 'check', namespace: 'shell' }));
        build.onLoad({ filter: /.*/, namespace: 'shell' }, () => ({ loader: 'js', resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
          export * from './src/features/servers/resources';
          export * from './src/features/servers/backup-jobs';
          export { removeServer, putSnapshot } from './src/features/servers/store';
          export { route, navigate, canGoBack, previousPath } from './src/app/router';
          export { createRoot, createSignal, flush, untrack } from 'solid-js';
          export { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
        ` }));
        build.onLoad({ filter: /features[\\/]servers[\\/](resources|backup-jobs)\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents: `
          const control = globalThis[${JSON.stringify(token)}];
          const Date = { now: () => control.now };
          const setTimeout = control.setTimeout, clearTimeout = control.clearTimeout;
          ${await readFile(path, 'utf8')}
        ` }));
        build.onLoad({ filter: /app[\\/]router\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents: `
          const { window, location, history } = globalThis[${JSON.stringify(token)}];
          ${await readFile(path, 'utf8')}
        ` }));
        build.onLoad({ filter: /features[\\/]servers[\\/]service\.ts$/ }, () => ({ loader: 'js', contents: 'export const serversApi = async () => ({ remove: async () => {} });' }));
      } }],
    });
    if (!built.success) throw new AggregateError(built.logs, 'Shell harness failed');
    const path = join(directory, 'check.mjs');
    await Bun.write(path, built.outputs[0]);
    const api = await import(pathToFileURL(path).href);
    c.settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); api.flush(); } };
    c.advance = async (ms) => {
      const end = c.now + ms;
      for (let i = 0; i < 100; i++) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        c.now = next[1].at; timers.delete(next[0]); next[1].callback(); await c.settle();
      }
      c.now = end; await c.settle();
    };
    await run(api, c);
  } finally {
    delete globalThis[token];
    await rm(directory, { recursive: true, force: true });
  }
}

test('[shell] readers, prefetch, remounts and versions share one exponential retry owner', () => resourceHarness(async (api, c) => {
  let loads = 0;
  let succeed = false;
  const def = api.serverResource('shared-retry', async () => { loads++; if (!succeed) throw { code: 'server_busy' }; return 'ready'; });
  const mount = () => api.createRoot(dispose => {
    const [version, setVersion] = api.createSignal(0);
    return { dispose, setVersion, read: api.useServerResource(() => 'shared', def, { version }) };
  });
  const { artifact } = await api.captureArtifact(async () => {
    const one = mount(), two = mount();
    await c.settle();
    expect(loads).toBe(1);
    expect(c.timers.size).toBe(1);
    expect(api.untrack(one.read.error)).toMatchObject({ code: 'server_busy' });
    const firstDeadline = api.untrack(() => api.serverPressure('shared')).untilMs;
    api.prefetchServerResource('shared', def);
    one.setVersion(1); two.setVersion(2);
    api.invalidateServerResources('shared');
    await Promise.all([one.read.refresh(), two.read.refresh()]);
    await c.settle();
    expect(loads).toBe(1);
    expect(c.timers.size).toBe(1);
    one.dispose(); two.dispose(); api.flush();
    expect(c.timers.size).toBe(0);
    const remounted = mount(); await c.settle();
    expect(loads).toBe(1);
    await c.advance(firstDeadline - c.now);
    expect(loads).toBe(2);
    const secondDeadline = api.untrack(() => api.serverPressure('shared')).untilMs;
    expect(secondDeadline - firstDeadline).toBeGreaterThanOrEqual(5000);
    expect(c.timers.size).toBe(1);
    succeed = true;
    await c.advance(secondDeadline - c.now);
    expect(loads).toBe(3);
    expect(api.untrack(remounted.read.value)).toBe('ready');
    expect(api.untrack(remounted.read.error)).toBeNull();
    expect(api.untrack(() => api.serverPressure('shared'))).toBeNull();
    remounted.dispose();
  }, { scenario: 'server-shared-retry' });
  api.expectNoDiagnostics(artifact);
}));

test('[shell] prefetch Retry-After is respected by later readers and explicit refresh', () => resourceHarness(async (api, c) => {
  let loads = 0;
  const def = api.serverResource('retry-after', async () => { if (++loads === 1) throw { code: 'rate_limited', retryAfterMs: 20000 }; return 'recovered'; });
  api.prefetchServerResource('guidance', def); await c.settle();
  expect(loads).toBe(1);
  expect(c.timers.size).toBe(0);
  const owner = api.createRoot(dispose => ({ dispose, read: api.useServerResource(() => 'guidance', def) }));
  await c.settle(); await owner.read.refresh();
  await c.advance(19999);
  expect(loads).toBe(1);
  await expect(api.readServerResource('guidance', def)).rejects.toMatchObject({ retryAfterMs: 20000 });
  await c.advance(1);
  expect(loads).toBe(2);
  expect(api.untrack(owner.read.value)).toBe('recovered');
  owner.dispose();
}));

test('[shell] invalidating an in-flight failure retains its shared retry deadline', () => resourceHarness(async (api, c) => {
  let reject;
  let loads = 0;
  const def = api.serverResource('in-flight', () => { loads++; return new Promise((_, fail) => { reject = fail; }); });
  const owner = api.createRoot(dispose => ({ dispose, read: api.useServerResource(() => 'retired', def) }));
  await c.settle();
  api.invalidateServerResources('retired'); api.flush();
  reject({ code: 'server_busy', retryAfterMs: 20000 }); await c.settle();
  expect(loads).toBe(1);
  expect(c.timers.size).toBe(1);
  expect(api.untrack(() => api.serverPressure('retired')).untilMs).toBe(21000);
  owner.dispose();
}));

test('[shell] pressure survives unrelated success and each resource recovers independently', () => resourceHarness(async (api, c) => {
  let busy = true;
  const one = api.serverResource('one', async () => { if (busy) throw { code: 'server_busy', retryAfterMs: 10000 }; return 1; });
  const two = api.serverResource('two', async () => { throw { code: 'rate_limited', retryAfterMs: 20000 }; });
  const okay = api.serverResource('okay', async () => 3);
  await Promise.allSettled([api.readServerResource('pressure', one), api.readServerResource('pressure', two)]);
  await api.readServerResource('pressure', okay);
  expect(api.untrack(() => api.serverPressure('pressure'))).toEqual({ code: 'rate_limited', untilMs: 21000 });
  busy = false; await c.advance(10000); await api.readServerResource('pressure', one);
  expect(api.untrack(() => api.serverPressure('pressure'))).toEqual({ code: 'rate_limited', untilMs: 21000 });
  await c.advance(10000);
  expect(api.untrack(() => api.serverPressure('pressure'))).toBeNull();
}));

test('[shell] eviction bounds metadata and removing a connection releases resources', () => resourceHarness(async (api, c) => {
  const def = api.serverResource('bounded', async () => 'value');
  for (let i = 0; i < 600; i++) {
    api.seedServerResource(`bounded-${i}`, def, i);
    api.invalidateServerResources(`signal-${i}`);
    api.untrack(() => api.serverPressure(`pressure-${i}`));
  }
  expect(api.serverResourceMetadata().keys).toBe(256);
  expect(api.serverResourceMetadata().versions).toBeLessThanOrEqual(256);
  expect(api.serverResourceMetadata().pressures).toBeLessThanOrEqual(256);
  expect(api.peekServerResource('bounded-0', def)).toBeUndefined();
  let complete;
  const pending = api.serverResource('pending', () => new Promise(resolve => { complete = resolve; }));
  const result = api.readServerResource('removed', pending).catch(() => undefined);
  await c.settle();
  api.putSnapshot({ connection: { id: 'removed' }, status: null });
  await api.removeServer('removed');
  complete('late'); await result;
  expect(api.peekServerResource('removed', pending)).toBeUndefined();
  expect(c.timers.size).toBe(0);
}));

test('[shell] legacy URLs normalize at initial load, hashchange and navigate using replace', () => resourceHarness(async (api, c) => {
  expect(api.untrack(api.route)).toMatchObject({ page: 'servers', section: 'c1', detail: 'settings', item: 'players' });
  expect(c.location.hash).toBe('#/servers/c1/settings/players');
  expect(c.history.state).toEqual({ vesta: 2, from: '/servers' });
  for (const [old, section] of Object.entries(legacyTabs)) {
    c.location.hash = `#/servers/c1/${old}`;
    c.listeners.hashchange(); api.flush();
    expect(api.untrack(api.route)).toMatchObject({ detail: 'settings', item: section });
    expect(c.location.hash).toBe(`#/servers/c1/settings/${section}`);
    api.navigate(`/servers/c2/${old}`); api.flush();
    expect(api.untrack(api.route)).toMatchObject({ section: 'c2', detail: 'settings', item: section });
  }
  expect(c.history.pushes).toHaveLength(0);
  expect(api.untrack(api.canGoBack)).toBe(true);
  expect(api.previousPath()).toBe('/servers');
  api.navigate('/servers/c1/files'); api.flush();
  expect(c.history.pushes).toEqual(['#/servers/c1/files']);
}, '/servers/c1/players'));

test('[shell] backup polling follows long jobs through terminal, refreshes projections and disposes timers', () => resourceHarness(async (api, c) => {
  let polls = 0, projections = 0;
  const job = (state) => ({ id: 'long-job', state });
  const follower = api.createBackupJobFollower({
    read: async () => [job(++polls < 4 ? 'running' : 'succeeded')],
    onTerminal: async () => { projections++; },
  });
  follower.observe([job('queued')]);
  await c.advance(9000);
  expect(polls).toBe(3); expect(projections).toBe(0); expect(c.timers.size).toBe(1);
  await c.advance(3000);
  expect(polls).toBe(4); expect(projections).toBe(1); expect(c.timers.size).toBe(0);
  follower.observe([{ id: 'second', state: 'queued' }]);
  expect(c.timers.size).toBe(1);
  follower.dispose();
  expect(c.timers.size).toBe(0);
  await c.advance(30000); expect(polls).toBe(4);
  const bounded = api.createBackupJobFollower({ read: async () => [job('running')], onTerminal: async () => {}, maxPolls: 2 });
  bounded.observe([job('queued')]); await c.advance(6000);
  expect(c.timers.size).toBe(0);
  bounded.dispose();
  let finish;
  const cancelled = api.createBackupJobFollower({
    read: () => new Promise(resolve => { finish = resolve; }),
    onTerminal: async () => { projections++; },
  });
  cancelled.observe([job('queued')]); await c.advance(3000);
  cancelled.dispose(); finish([job('succeeded')]); await c.settle();
  expect(projections).toBe(1);
  expect(c.timers.size).toBe(0);
}));
