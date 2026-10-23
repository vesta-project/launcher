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
    expect(ids).toEqual(['overview', 'console', 'files', 'automation', 'backups', 'activity']);
  });

  test('backups show only when the server has a backup profile', () => {
    const ids = (configured, requested) => visibleMainTabs({ snapshot: snapshot(), backupsConfigured: configured, requested }).map((tab) => tab.id);
    expect(ids(false)).not.toContain('backups');
    expect(ids(undefined)).not.toContain('backups');
    // A deep link keeps the tab while the answer is still loading.
    expect(ids(undefined, 'backups')).toContain('backups');
    expect(ids(false, 'backups')).not.toContain('backups');
    expect(backupsConfigured(snapshot(), undefined)).toBeUndefined();
    expect(backupsConfigured(snapshot(), { profiles: [] })).toBe(false);
    expect(backupsConfigured(snapshot(), { profiles: [{}] })).toBe(true);
    expect(backupsConfigured({ ...snapshot(), backupsConfigured: false }, { profiles: [{}] })).toBe(false);
    expect(backupsConfigured(snapshot({}, 'viewer'), { profiles: [{}] })).toBe(false);
  });

  test('settings sections follow capabilities; connection is always there', () => {
    expect(visibleSections(snapshot()).map((section) => section.id)).toEqual(['general', 'game', 'presence', 'players', 'access', 'connection']);
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
