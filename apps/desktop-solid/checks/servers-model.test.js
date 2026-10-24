import { describe, expect, test } from 'bun:test';
import { DEFAULT_PORT, isPairingCode, parseAddressInput, parseHostPort } from '../src/features/servers/address';
import { anyVisible, capabilitiesForRole, gate, roleKey } from '../src/features/servers/capabilities';
import { ConsoleBuffer } from '../src/features/servers/console-model';
import { errorPresentation, serverErrorPresentation, toServerError } from '../src/features/servers/errors';
import { differingGroups, groupFingerprint, normalizeFingerprint, sameFingerprint } from '../src/features/servers/fingerprint';
import {
  accessFact, age, connectionFact, consoleLineProblem, formatUptime, isPlayerName, lifecycleControls, minecraftFact, playersFact, statusDot,
} from '../src/features/servers/model';
import { busyIntent, isTerminal, mergeOperations, operationStateMessage } from '../src/features/servers/operations-model';
import { IntentMemo, minecraftFactNow, outcomeUncertain } from '../src/features/servers/model';

const FP = 'a3f19c0d7be24e86c5d9017f3a6b28e4c90d5f17e2b8a4c6d3e0f9b7a1c5e823';
const status = (patch = {}) => ({
  state: 'running', lifecycle: 'online', generation: 'g'.repeat(32), playerCount: 2, playerCountKnown: true,
  playerCountObservedAtMs: 1_000, uptimeSeconds: '3700', readiness: 'ready', readinessReason: null,
  readinessEvidence: 'log_and_probe', supervision: 'separate', supervisor: null, ...patch,
});
const snapshot = (patch = {}) => ({
  connection: { id: 'c1', name: 'Test', endpoint: 'host:8443', serverId: 's', fingerprint: FP, role: 'owner', signInMethod: 'pairing_code', memoryOnly: false, pinned: false, addedAtMs: 0, lastConnectedAtMs: 0 },
  state: { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
  info: null, status: status(), statusObservedAtMs: 0, pack: null,
  capabilities: { source: 'session', granted: capabilitiesForRole('owner'), refused: [] },
  restartRequired: false,
  ...patch,
});

describe('[connectivity] server address entry', () => {
  test('accepts DNS names, IPv4 and bracketed IPv6 with the default port 8443', () => {
    expect(parseHostPort('play.example.net')).toMatchObject({ host: 'play.example.net', port: DEFAULT_PORT, display: 'play.example.net:8443' });
    expect(parseHostPort('192.168.1.20:25000')).toMatchObject({ host: '192.168.1.20', port: 25000 });
    expect(parseHostPort('[2001:db8::1]:8443')).toMatchObject({ host: '2001:db8::1', display: '[2001:db8::1]:8443' });
    expect(parseHostPort('https://Play.Example.NET:9443/')).toMatchObject({ host: 'play.example.net', port: 9443 });
  });
  test('refuses non-https schemes, credentials, paths and bad ports', () => {
    expect(parseHostPort('http://host')).toEqual({ kind: 'invalid', problem: 'scheme' });
    expect(parseHostPort('https://user:pw@host')).toEqual({ kind: 'invalid', problem: 'credentials' });
    expect(parseHostPort('https://host/api/v3')).toEqual({ kind: 'invalid', problem: 'path' });
    expect(parseHostPort('host:0').kind).toBe('invalid');
    expect(parseHostPort('host:70000').kind).toBe('invalid');
    expect(parseHostPort('').kind).toBe('invalid');
    expect(parseHostPort('-bad-.example').kind).toBe('invalid');
  });
  test('reads a pairing link carrying endpoint, code, fingerprint and server id', () => {
    const code = 'A'.repeat(43);
    const link = `vesta://pair?endpoint=${encodeURIComponent('https://play.example.net:8443')}&code=${code}&fp=${FP.toUpperCase()}&sid=srv_1`;
    expect(parseAddressInput(link)).toMatchObject({ kind: 'link', code, fingerprint: FP, serverId: 'srv_1', address: { display: 'play.example.net:8443' } });
    expect(parseAddressInput('vesta://pair?code=x').kind).toBe('invalid');
    expect(parseAddressInput(`vesta://pair?endpoint=https%3A%2F%2Fh&fp=nothex`).kind).toBe('invalid');
  });
  test('pairing codes are 43 base64url characters', () => {
    expect(isPairingCode('A'.repeat(43))).toBe(true);
    expect(isPairingCode('A'.repeat(42))).toBe(false);
    expect(isPairingCode(`${'A'.repeat(42)}=`)).toBe(false);
  });
});

describe('[trust] fingerprint comparison', () => {
  test('normalizes separators and case, and rejects non SHA-256 input', () => {
    expect(normalizeFingerprint(FP.toUpperCase().match(/../g).join(':'))).toBe(FP);
    expect(normalizeFingerprint('abc')).toBeNull();
    expect(groupFingerprint(FP)).toHaveLength(16);
  });
  test('a single differing group is a mismatch and is highlighted', () => {
    const other = `ffff${FP.slice(4)}`;
    expect(sameFingerprint(FP, other)).toBe(false);
    expect(sameFingerprint(FP, FP.toUpperCase())).toBe(true);
    expect(sameFingerprint(null, FP)).toBe(false);
    expect(differingGroups(FP, other)).toEqual([0]);
  });
});

describe('[errors] closed client error model', () => {
  test('every code has one message and one action, and unknown rejections become internal', () => {
    for (const [code, presentation] of Object.entries(errorPresentation)) {
      expect(presentation.message, code).toMatch(/^servers\.error\./);
      expect(presentation.action, code).toBeTruthy();
    }
    expect(toServerError(new Error('boom'))).toEqual({ code: 'internal' });
    expect(toServerError({ code: 'not-a-code' })).toEqual({ code: 'internal' });
    expect(toServerError({ code: 'rate_limited', retryAfterMs: 2000 })).toEqual({ code: 'rate_limited', retryAfterMs: 2000 });
  });
  test('rejected credentials never claim the device was revoked', () => {
    expect(errorPresentation.credentials_rejected.action).toBe('pair_again');
    expect(errorPresentation.pair_outcome_unknown.action).toBe('new_code');
  });
  test('unconfigured backups are distinct from an unsupported server version', () => {
    expect(toServerError({ code: 'backups_not_configured' })).toEqual({ code: 'backups_not_configured' });
    expect(errorPresentation.backups_not_configured.message).toBe('servers.error.backups-not-configured');
    expect(errorPresentation.backups_not_configured.message).not.toBe(errorPresentation.unsupported.message);
  });
  test('local pacing does not claim the server is refusing requests', () => {
    expect(serverErrorPresentation({ code: 'rate_limited', localPressure: true }).message).toBe('servers.error.client-rate-limited');
    expect(serverErrorPresentation({ code: 'server_busy', localPressure: true }).message).toBe('servers.error.client-busy');
    expect(serverErrorPresentation({ code: 'rate_limited' }).message).toBe('servers.error.rate-limited');
    expect(serverErrorPresentation({ code: 'server_busy' }).message).toBe('servers.error.server-busy');
  });
});

describe('[authorization] capability gating is a hint, never authority', () => {
  test('built-in role defaults match the agent: moderators have no raw console, maintainers no OP', () => {
    expect(roleKey('Admin')).toBe('administrator');
    expect(capabilitiesForRole('moderator')).not.toContain('console.read');
    expect(capabilitiesForRole('moderator')).toContain('players.moderate');
    expect(capabilitiesForRole('maintainer')).not.toContain('players.operator');
    expect(capabilitiesForRole('viewer')).not.toContain('console.read');
    expect(capabilitiesForRole('owner')).toContain('backups.restore');
    expect(capabilitiesForRole('custom-role')).toBeUndefined();
  });
  test('unknown capabilities stay visible until the server refuses them', () => {
    const view = { source: 'unknown', granted: [], refused: [] };
    expect(gate(view, 'console.read')).toBe('unknown');
    view.refused.push('console.read');
    expect(gate(view, 'console.read')).toBe('denied');
    expect(gate({ source: 'session', granted: ['status.view'], refused: [] }, 'console.read')).toBe('denied');
    expect(anyVisible({ source: 'role_defaults', granted: ['tasks.view'], refused: [] }, ['tasks.view'])).toBe(true);
  });
});

describe('[state] connection, access and Minecraft are separate facts', () => {
  test('a reachable agent with a stopped game is not "online"', () => {
    const value = snapshot({ status: status({ state: 'stopped', lifecycle: 'offline', generation: null, playerCount: null, playerCountKnown: false }) });
    expect(connectionFact(value, 0).message).toBe('servers.connection.online');
    expect(minecraftFact(value.status).message).toBe('servers.minecraft.stopped');
    expect(statusDot(value)).toBe('stopped');
  });
  test('lifecycle states from sleep mode and crash loop take priority', () => {
    expect(minecraftFact(status({ lifecycle: 'sleeping', state: 'stopped' })).message).toBe('servers.minecraft.sleeping');
    expect(minecraftFact(status({ lifecycle: 'crash_loop' })).tone).toBe('danger');
    expect(minecraftFact(status({ readiness: 'degraded' })).message).toBe('servers.minecraft.degraded');
    expect(minecraftFact(null).message).toBe('servers.minecraft.unknown');
  });
  test('unknown player counts are never shown as zero, and stale counts carry their age', () => {
    expect(playersFact(status({ playerCountKnown: false, playerCount: null }), 0).message).toBe('servers.players.unknown');
    expect(playersFact(status({ state: 'stopped' }), 0).message).toBe('servers.players.none-running');
    expect(playersFact(null, 0).message).toBe('servers.players.unknown');
    const known = playersFact(status(), 61_000);
    expect(known.args).toEqual({ count: 2 });
    expect(known.seen).toEqual({ message: 'servers.age.minutes', count: 1 });
  });
  test('backoff and rate limiting show a countdown; trust problems mark the server', () => {
    expect(connectionFact(snapshot({ state: { phase: 'backoff', access: 'paired', retryAtMs: 20_000, rateLimitedUntilMs: null, lastError: 'unreachable' } }), 10_000).args).toEqual({ count: 10 });
    expect(connectionFact(snapshot({ state: { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: 5_000, lastError: null } }), 0).message).toBe('servers.connection.rate-limited');
    expect(statusDot(snapshot({ state: { phase: 'online', access: 'fingerprint_changed', retryAtMs: null, rateLimitedUntilMs: null, lastError: null } }))).toBe('problem');
    expect(accessFact(snapshot()).args).toEqual({ name: 'Owner' });
  });
  test('ages and uptime format coarsely', () => {
    expect(age(0, 59_000)).toEqual({ message: 'servers.age.seconds', count: 59 });
    expect(age(0, 3 * 3_600_000)).toEqual({ message: 'servers.age.hours', count: 3 });
    expect(formatUptime('3700')).toBe('1h 1m');
    expect(formatUptime('90000')).toBe('1d 1h');
    expect(formatUptime(null)).toBeNull();
    expect(formatUptime('-1')).toBeNull();
  });
});

describe('[lifecycle] explicit start, stop, restart and force kill', () => {
  test('stopped offers Start; running offers Stop and Restart; stopping swaps Stop for Force kill', () => {
    expect(lifecycleControls(snapshot({ status: status({ state: 'stopped', generation: null }) }))).toMatchObject({ primary: 'start', restart: false });
    expect(lifecycleControls(snapshot())).toMatchObject({ primary: 'stop', restart: true });
    expect(lifecycleControls(snapshot({ status: status({ state: 'stopping' }) }))).toMatchObject({ primary: 'kill', restart: false });
  });
  test('controls are withheld when offline, unpaired, unknown, crash-looping or not permitted', () => {
    expect(lifecycleControls(snapshot({ state: { phase: 'backoff', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null } })).primary).toBeNull();
    expect(lifecycleControls(snapshot({ state: { phase: 'online', access: 'credentials_rejected', retryAtMs: null, rateLimitedUntilMs: null, lastError: null } })).primary).toBeNull();
    expect(lifecycleControls(snapshot({ status: null })).blocked).toBe('servers.lifecycle.unknown-state');
    expect(lifecycleControls(snapshot({ status: status({ lifecycle: 'crash_loop' }) })).blocked).toBe('servers.lifecycle.needs-attention');
    const viewer = snapshot({ capabilities: { source: 'role_defaults', granted: capabilitiesForRole('viewer'), refused: [] } });
    expect(lifecycleControls(viewer)).toMatchObject({ primary: null, restart: false, blocked: 'servers.lifecycle.not-allowed' });
    const noKill = snapshot({ status: status({ state: 'stopping' }), capabilities: { source: 'session', granted: ['lifecycle.stop'], refused: [] } });
    expect(lifecycleControls(noKill).primary).toBeNull();
  });
});

describe('[operations] accepted is not completed', () => {
  const op = (id, state, patch = {}) => ({ operationId: id, intent: 'lifecycle.start', state, progressPercent: null, createdAtMs: 1, updatedAtMs: 1, finishedAtMs: null, reconciling: false, ...patch });
  test('queued reads as accepted, uncertain submissions read as checking', () => {
    expect(operationStateMessage(op('a', 'queued'))).toBe('servers.operation.accepted');
    expect(operationStateMessage(op('a', 'running', { reconciling: true }))).toBe('servers.operation.checking');
    expect(isTerminal(op('a', 'recovery_required'))).toBe(true);
    expect(isTerminal(op('a', 'awaiting_confirmation'))).toBe(false);
  });
  test('an unfinished or reconciling intent cannot be submitted again', () => {
    expect(busyIntent([op('a', 'running')], 'lifecycle.start')).toBe(true);
    expect(busyIntent([op('a', 'succeeded', { reconciling: true })], 'lifecycle.start')).toBe(true);
    expect(busyIntent([op('a', 'succeeded')], 'lifecycle.start')).toBe(false);
  });
  test('merging keeps the newest record and the known intent label', () => {
    const merged = mergeOperations([op('a', 'running', { updatedAtMs: 5 })], [op('a', 'queued', { updatedAtMs: 2 }), op('b', 'queued', { intent: null, createdAtMs: 9 })]);
    expect(merged.map((entry) => [entry.operationId, entry.state])).toEqual([['b', 'queued'], ['a', 'running']]);
    expect(mergeOperations([op('a', 'running')], [op('a', 'succeeded', { intent: null, updatedAtMs: 3 })])[0].intent).toBe('lifecycle.start');
  });
});

describe('[console] bounded history with visible gaps', () => {
  const lines = (from, count) => Array.from({ length: count }, (_, index) => ({ cursor: String(from + index), text: `line ${from + index}`, truncated: false }));
  test('caps retained lines and counts what was dropped', () => {
    const buffer = new ConsoleBuffer(100);
    buffer.append(lines(0, 150));
    expect(buffer.lineCount).toBe(100);
    expect(buffer.dropped).toBe(50);
    expect(buffer.entries[0].cursor).toBe('50');
  });
  test('merges the retained tail around live lines by cursor overlap', () => {
    const buffer = new ConsoleBuffer();
    buffer.append(lines(10, 5));
    expect(buffer.append(lines(12, 5))).toBe(2);
    // The tail page (oldest first) overlaps what the stream already delivered.
    expect(buffer.merge(lines(5, 14))).toBe(7);
    expect(buffer.entries.map((entry) => entry.cursor)).toEqual(['5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18']);
  });
  test('a tail with no overlap goes on top behind a gap instead of inventing continuity', () => {
    const buffer = new ConsoleBuffer();
    buffer.append(lines(100, 2));
    buffer.merge(lines(0, 2));
    expect(buffer.entries.map((entry) => entry.kind === 'gap' ? 'gap' : entry.cursor)).toEqual(['0', '1', 'gap', '100', '101']);
  });
  test('gaps stay visible markers, consecutive gaps collapse, and markers count toward the bound', () => {
    const buffer = new ConsoleBuffer(4);
    buffer.append(lines(0, 2));
    buffer.gap('c');
    buffer.gap('c');
    expect(buffer.entries.filter((entry) => entry.kind === 'gap')).toHaveLength(1);
    buffer.append(lines(10, 3));
    expect(buffer.entries).toHaveLength(4);
    expect(buffer.entries.map((entry) => entry.kind === 'gap' ? 'gap' : entry.cursor)).toEqual(['gap', '10', '11', '12']);
  });
  test('command lines follow the server rules: ≤1,024 bytes and no control characters', () => {
    expect(consoleLineProblem('say hi')).toBeNull();
    expect(consoleLineProblem('   ')).toBe('servers.console.empty');
    expect(consoleLineProblem('a'.repeat(1025))).toBe('servers.console.too-long');
    expect(consoleLineProblem('é'.repeat(513))).toBe('servers.console.too-long');
    expect(consoleLineProblem('say a\nstop')).toBe('servers.console.control-characters');
    expect(consoleLineProblem(`say a${String.fromCharCode(0x2028)}b`)).toBe('servers.console.control-characters');
  });
  test('moderation accepts Java Edition names only', () => {
    expect(isPlayerName('Notch_99')).toBe(true);
    expect(isPlayerName('a'.repeat(17))).toBe(false);
    expect(isPlayerName('@a')).toBe(false);
    expect(isPlayerName('bob; op me')).toBe(false);
  });
});

describe('[idempotency] retries never create a second intent', () => {
  test('an uncertain outcome keeps the intent for an identical retry', () => {
    let next = 0;
    const memo = new IntentMemo(() => `id-${++next}`);
    const first = memo.idFor({ text: 'say hi', generation: 'g1' });
    memo.settle({ code: 'outcome_unknown' });
    expect(memo.uncertain).toBe(true);
    expect(memo.idFor({ text: 'say hi', generation: 'g1' })).toBe(first);
    memo.settle();
    expect(memo.idFor({ text: 'say hi', generation: 'g1' })).not.toBe(first);
  });
  test('a different payload or a definite rejection starts a new intent', () => {
    let next = 0;
    const memo = new IntentMemo(() => `id-${++next}`);
    const first = memo.idFor({ action: 'stop', generation: 'g1' });
    memo.settle({ code: 'timeout' });
    expect(memo.idFor({ action: 'stop', generation: 'g2' })).not.toBe(first);
    const second = memo.idFor({ action: 'start' });
    memo.settle({ code: 'stale_target' });
    expect(memo.uncertain).toBe(false);
    expect(memo.idFor({ action: 'start' })).not.toBe(second);
  });
  test('only lost or ambiguous outcomes count as uncertain', () => {
    for (const code of ['outcome_unknown', 'timeout', 'unreachable', 'internal', 'pair_outcome_unknown']) expect(outcomeUncertain(code), code).toBe(true);
    for (const code of ['forbidden', 'stale_target', 'conflict', 'invalid_input', 'confirmation_expired']) expect(outcomeUncertain(code), code).toBe(false);
  });
});

describe('[state] last-known Minecraft state while disconnected', () => {
  test('shows the value with its age and without a success tone', () => {
    const offline = snapshot({ state: { phase: 'backoff', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: 'unreachable' }, statusObservedAtMs: 0 });
    expect(minecraftFactNow(offline, 120_000)).toMatchObject({ message: 'servers.minecraft.ready', tone: 'neutral', seen: { message: 'servers.age.minutes', count: 2 } });
    expect(minecraftFactNow(snapshot({ statusObservedAtMs: 115_000 }), 120_000).seen).toBeUndefined();
  });
});
