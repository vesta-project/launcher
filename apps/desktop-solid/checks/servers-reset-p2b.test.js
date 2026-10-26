// Pure rules behind the phase-two reset UI: the World page (D1), the Java picker (D5),
// raw protected-file editing (D4) and Access grouping (D7).
import { describe, expect, test } from 'bun:test';
import {
  SEED_MASK, retainDatapackIntent, settleDatapackIntent, datapackBlocker, datapackViews, dimensionViews, seedRevealed, seedText, splitLayout, toggleFeedback, toggleRejection, worldSize,
} from '../src/features/servers/world-model';
import {
  customPathProblem, downloadOffers, isJavaJob, javaCompatibility, javaGroups, javaJobMessage, javaRejection, runtimeFor,
} from '../src/features/servers/server-java-model';
import { fileActions } from '../src/features/servers/files-model';
import {
  IDLE, protectedLeaveDestination, protectedAccess, protectedEditReducer, protectedEditSends, protectedErrorEvent, protectedErrorMessage, protectedResultEvent, protectedSection,
} from '../src/features/servers/protected-edit';
import { capabilitiesForRole } from '../src/features/servers/capabilities';
import { createFixtureServers } from '../src/features/servers/fixtures';
import { deviceNameProblem, groupAccess, isManagement, renamable, sortDevices } from '../src/features/servers/access-model';

const caps = (granted) => ({ source: 'session', granted, refused: [] });
const running = { state: { phase: 'online' }, status: { state: 'running', generation: 'g1' }, capabilities: caps(['config.edit', 'console.write']) };

describe('[world] seed masking', () => {
  test('hidden by default; hover or focus reveals; a click pins it', () => {
    expect(seedRevealed({ pinned: false, hovering: false, privacy: false })).toBe(false);
    expect(seedRevealed({ pinned: false, hovering: true, privacy: false })).toBe(true);
    expect(seedRevealed({ pinned: true, hovering: false, privacy: false })).toBe(true);
  });
  test('privacy mode ignores hover; only a deliberate click reveals', () => {
    expect(seedRevealed({ pinned: false, hovering: true, privacy: true })).toBe(false);
    expect(seedRevealed({ pinned: true, hovering: false, privacy: true })).toBe(true);
  });
  test('the mask never leaks digits or length', () => {
    const short = seedText('42', false); const long = seedText('-4172144997902289642', false);
    expect(short).toEqual({ text: SEED_MASK, masked: true });
    expect(long.text).toBe(short.text);
    expect(SEED_MASK).not.toMatch(/\d/);
    expect(seedText('-4172144997902289642', true)).toEqual({ text: '-4172144997902289642', masked: false });
    expect(seedText(null, true)).toBeNull();
  });
});

describe('[world] size, dimensions and datapacks', () => {
  test('size is partial while the bounded scan is incomplete, unknown when null', () => {
    expect(worldSize({ sizeBytes: '2846072184', sizeComplete: true })).toEqual({ message: 'server-world.size', size: '2.7 GB' });
    expect(worldSize({ sizeBytes: '2846072184', sizeComplete: false }).message).toBe('server-world.size-partial');
    expect(worldSize({ sizeBytes: null, sizeComplete: false })).toBeNull();
  });
  test('overworld, nether and end always show in order; extra dimensions follow', () => {
    const views = dimensionViews([
      { id: 'end', present: true, folders: ['world_the_end/DIM1'], layout: 'split' },
      { id: 'mymod:moon', present: true, folders: ['world/dimensions/mymod/moon'], layout: 'nested' },
      { id: 'overworld', present: true, folders: ['world'], layout: 'nested' },
    ]);
    expect(views.map((view) => view.id)).toEqual(['overworld', 'nether', 'end', 'mymod:moon']);
    expect(views[1]).toMatchObject({ present: false, label: 'server-world.dimension-nether' });
    expect(views[2].split).toBe(true);
    expect(views[3].label).toBeNull();
  });
  test('split folders are explained only when a generated dimension is split', () => {
    expect(splitLayout([{ id: 'nether', present: true, folders: [], layout: 'split' }])).toBe(true);
    expect(splitLayout([{ id: 'nether', present: false, folders: [], layout: 'split' }])).toBe(false);
  });
  test('datapacks: built-in first, then by name, missing last; vanilla and missing packs never toggle', () => {
    const views = datapackViews([
      { id: 'file/zeta.zip', name: 'zeta.zip', kind: 'zip', path: 'world/datapacks/zeta.zip', enabled: false },
      { id: 'file/gone', name: 'gone', kind: 'missing', path: null, enabled: true },
      { id: 'file/alpha', name: 'alpha', kind: 'folder', path: 'world/datapacks/alpha', enabled: null },
      { id: 'vanilla', name: 'Vanilla', kind: 'builtin', path: null, enabled: true },
    ]);
    expect(views.map((view) => view.id)).toEqual(['vanilla', 'file/alpha', 'file/zeta.zip', 'file/gone']);
    expect(views.map((view) => view.state)).toEqual(['enabled', 'unknown', 'disabled', 'missing']);
    expect(views.map((view) => view.toggleable)).toEqual([false, true, true, false]);
  });
  test('stopped edits need config.edit; running commands also need console.write', () => {
    expect(datapackBlocker(running)).toBeNull();
    expect(datapackBlocker({ ...running, status: { state: 'stopped', generation: null } })).toBeNull();
    expect(datapackBlocker({ ...running, state: { phase: 'backoff' } })).toBe('server-world.pack-offline');
    expect(datapackBlocker({ ...running, capabilities: caps(['config.edit']) })).toBe('server-world.pack-no-permission');
    expect(datapackBlocker({ ...running, status: { state: 'stopped', generation: null }, capabilities: caps(['config.edit']) })).toBeNull();
    expect(datapackBlocker({ ...running, status: { ...running.status, readiness: 'starting' } })).toBe('server-world.pack-transitioning');
  });
  test('toggle feedback follows the operation; completion only proves submission', () => {
    expect(toggleFeedback(undefined)).toEqual({ step: 'sending' });
    expect(toggleFeedback({ state: 'running', reconciling: false })).toEqual({ step: 'sent' });
    expect(toggleFeedback({ state: 'succeeded', reconciling: true })).toEqual({ step: 'sent' });
    expect(toggleFeedback({ state: 'succeeded', reconciling: false })).toEqual({ step: 'done' });
    expect(toggleFeedback({ state: 'failed', reconciling: false, outcome: 'stale_generation' })).toEqual({ step: 'failed', message: 'server-world.pack-restarted' });
    expect(toggleRejection('datapack_requires_running_game', 'conflict')).toBe('server-world.pack-needs-running');
    expect(toggleRejection(null, 'forbidden')).toBe('server-world.pack-no-permission');
  });
});

const rt = (id, major, extra = {}) => ({ id, path: `/opt/${id}/bin/java`, version: `${major}.0.1`, major, vendor: 'Eclipse Adoptium', arch: 'amd64', managed: false, ...extra });

describe('[java] runtime list', () => {
  const inventory = {
    runtimes: [rt('a17', 17), rt('m21', 21, { managed: true }), rt('d21', 21, { vendor: 'Azul' }), rt('b25', 25)],
    selected: rt('d21', 21, { vendor: 'Azul' }), customPathsAllowed: false, managedMajors: [21],
  };
  test('groups per major, newest first; selected first, then managed, detected', () => {
    const groups = javaGroups(inventory, 21);
    expect(groups.map((group) => group.major)).toEqual([25, 21, 17]);
    const java21 = groups[1];
    expect(java21).toMatchObject({ inUse: true, required: true, missing: false });
    expect(java21.rows.map((row) => [row.runtime.id, row.source, row.selected])).toEqual([['d21', 'detected', true], ['m21', 'managed', false]]);
  });
  test('a required major with nothing installed gets an empty, downloadable group', () => {
    const groups = javaGroups({ ...inventory, runtimes: [rt('a17', 17)], selected: rt('a17', 17) }, 21);
    expect(groups.map((group) => [group.major, group.missing])).toEqual([[21, true], [17, false]]);
  });
  test('a selected runtime the agent did not list came from a custom path', () => {
    const custom = rt('C:/Java/approved/jdk/bin/java.exe', 21);
    const groups = javaGroups({ ...inventory, selected: custom }, null);
    expect(groups.find((group) => group.major === 21).rows[0]).toMatchObject({ source: 'custom', selected: true });
  });
  test('download offers: required first, then LTS lines not installed', () => {
    expect(downloadOffers({ ...inventory, runtimes: [rt('a17', 17)] }, 21)).toEqual([21, 25]);
    expect(downloadOffers(inventory, null)).toEqual([]);
  });
  test('runtimeFor prefers a managed runtime of the major', () => {
    expect(runtimeFor(inventory, 21).id).toBe('m21');
    expect(runtimeFor(inventory, 8)).toBeNull();
    expect(runtimeFor(undefined, 21)).toBeNull();
  });
});

describe('[java] compatibility, custom paths and jobs', () => {
  test('the plan decides; a missing verdict is unknown, never ok', () => {
    expect(javaCompatibility({ java: { major: 21 }, javaCompatible: true, selectedJavaMajor: 21, managedDownloadMajor: null }).state).toBe('ok');
    expect(javaCompatibility({ java: { major: 21 }, javaCompatible: false, selectedJavaMajor: 17, managedDownloadMajor: 21 }))
      .toEqual({ state: 'incompatible', required: 21, selected: 17, download: 21 });
    expect(javaCompatibility({ java: { major: 21 } })).toEqual({ state: 'unknown', required: 21, selected: null, download: null });
  });
  test('custom paths must be absolute and name the java program', () => {
    expect(customPathProblem('')).toBe('server-java.custom-empty');
    expect(customPathProblem('jdk/bin/java')).toBe('server-java.custom-absolute');
    expect(customPathProblem('C:/Java/../evil/java.exe')).toBe('server-java.custom-absolute');
    expect(customPathProblem('C:/Java/jdk/bin/javac.exe')).toBe('server-java.custom-executable');
    expect(customPathProblem(['C:', 'Java', 'jdk-21', 'bin', 'java.exe'].join('\\'))).toBeNull();
    expect(customPathProblem('/usr/lib/jvm/temurin-21/bin/java')).toBeNull();
  });
  test('java jobs are told apart from software jobs and have their own copy', () => {
    expect(isJavaJob({ kind: 'java_download' })).toBe(true);
    expect(isJavaJob({ kind: 'apply' })).toBe(false);
    expect(javaJobMessage({ kind: 'java_download', state: 'succeeded' })).toBe('server-java.download-done');
    expect(javaJobMessage({ kind: 'java_select', state: 'failed' })).toBe('server-java.select-failed');
    expect(javaJobMessage({ kind: 'java_select', state: 'staging' })).toBe('server-java.selecting');
    expect(javaRejection('conflict', 'software_state_unavailable')).toBe('server-java.stop-first');
    expect(javaRejection('forbidden', null)).toBe('server-java.custom-refused');
  });
});

const roleView = (role) => ({ source: 'role_defaults', granted: capabilitiesForRole(role), refused: [] });

describe('[protected files] who may edit raw', () => {
  test('owners and admins edit the root documents with confirmation; others are redirected', () => {
    for (const role of ['owner', 'administrator']) expect(protectedAccess(roleView(role), 'server.properties', 'confirm_edit')).toBe('raw');
    expect(protectedAccess(roleView('maintainer'), 'ops.json', 'confirm_edit')).toBe('redirect');
    expect(protectedAccess(roleView('owner'), 'eula.txt', 'normal')).toBe('none');
  });
  test('an older agent without the flag keeps nested look-alikes locked', () => {
    expect(protectedAccess(roleView('owner'), 'whitelist.json')).toBe('raw');
    expect(protectedAccess(roleView('owner'), 'backup/whitelist.json')).toBe('redirect');
    expect(protectedAccess(roleView('owner'), 'backup/whitelist.json', 'normal')).toBe('none');
  });
  test('raw documents open in the editor but are never renamed or deleted from Files', () => {
    const owner = fileActions(roleView('owner'), 'ops.json', { kind: 'file', size: '3', protection: 'confirm_edit' });
    expect(owner).toEqual({ open: true, edit: true, rename: false, delete: false, download: true });
    const maintainer = fileActions(roleView('maintainer'), 'ops.json', { kind: 'file', size: '3', protection: 'confirm_edit' });
    expect(maintainer).toEqual({ open: false, edit: false, rename: false, delete: false, download: false });
    expect(protectedSection('server.properties')).toBe('game');
    expect(protectedSection('banned-ips.json')).toBe('players');
  });
});

describe('[protected files] edit state machine', () => {
  const server = { text: 'theirs', sha256: 'sha-new', size: '6', binary: false, truncated: false };
  const run = (events, from = IDLE) => events.reduce(protectedEditReducer, from);
  test('save → validate → confirm → write with the token → idle', () => {
    let state = run([{ type: 'save', text: 'mine', expected: 'sha-old' }]);
    expect(state).toEqual({ step: 'preparing', text: 'mine', expected: 'sha-old' });
    expect(protectedEditSends(state)).toBe(true);
    state = protectedEditReducer(state, protectedResultEvent({ kind: 'awaitingConfirmation', operationId: 'o', confirmationToken: 'tok', expiresAtMs: 2_000 }));
    expect(state).toMatchObject({ step: 'confirm', token: 'tok' });
    expect(protectedEditSends(state)).toBe(false);
    state = protectedEditReducer(state, { type: 'confirm', nowMs: 1_000 });
    expect(state).toEqual({ step: 'applying', text: 'mine', expected: 'sha-old', token: 'tok' });
    expect(protectedEditReducer(state, protectedResultEvent({ kind: 'applied', sha256: 'x', restartNeeded: true }))).toBe(IDLE);
  });
  test('cancelling the confirmation writes nothing', () => {
    expect(run([{ type: 'save', text: 'm', expected: 'a' }, { type: 'prepared', token: 't', expiresAtMs: 9 }, { type: 'cancel' }])).toBe(IDLE);
  });
  test('an expired token is asked for again rather than sent', () => {
    const confirm = run([{ type: 'save', text: 'm', expected: 'a' }, { type: 'prepared', token: 't', expiresAtMs: 1_000 }]);
    expect(protectedEditReducer(confirm, { type: 'confirm', nowMs: 1_000 })).toEqual({ step: 'preparing', text: 'm', expected: 'a' });
    const applying = protectedEditReducer(confirm, { type: 'confirm', nowMs: 10 });
    expect(protectedEditReducer(applying, protectedErrorEvent({ code: 'confirmation_expired' }))).toEqual({ step: 'preparing', text: 'm', expected: 'a' });
  });
  test('stale: compare, then reload theirs or overwrite after a fresh confirmation', () => {
    expect(protectedErrorEvent({ code: 'stale_target' })).toBeNull();
    const conflict = run([{ type: 'save', text: 'mine', expected: 'sha-old' }, { type: 'stale', server }]);
    expect(conflict).toEqual({ step: 'conflict', text: 'mine', server });
    expect(protectedEditReducer(conflict, { type: 'reload' })).toBe(IDLE);
    const again = protectedEditReducer(conflict, { type: 'overwrite' });
    expect(again).toEqual({ step: 'preparing', text: 'mine', expected: 'sha-new' });
    expect(protectedEditReducer(again, { type: 'prepared', token: 't2', expiresAtMs: 5 }).step).toBe('confirm');
    // No validator for the server copy (preview only): nothing to overwrite against.
    expect(protectedEditReducer({ ...conflict, server: { ...server, sha256: null } }, { type: 'overwrite' }).step).toBe('conflict');
  });
  test('deleted on the server, refusals and unrelated events', () => {
    expect(run([{ type: 'save', text: 'm', expected: 'a' }, protectedErrorEvent({ code: 'not_found' })])).toEqual({ step: 'gone' });
    expect(run([{ type: 'save', text: 'm', expected: 'a' }, protectedErrorEvent({ code: 'invalid_input' })])).toBe(IDLE);
    expect(protectedErrorMessage({ code: 'invalid_input' }, 'ops.json')).toBe('server-files.raw-invalid-json');
    expect(protectedErrorMessage({ code: 'invalid_input' }, 'server.properties')).toBe('server-files.raw-invalid-properties');
    expect(protectedEditReducer(IDLE, { type: 'confirm', nowMs: 0 })).toBe(IDLE);
  });
  test('fixtures: the token write applies only with the same intent and validator', async () => {
    const servers = createFixtureServers({ latencyMs: 0 });
    const file = await servers.fileReadText('fixture-survival', 'ops.json');
    const next = `${file.text.trim()} \n`;
    const first = await servers.fileWriteProtected('fixture-survival', 'ops.json', next, file.sha256, null, 'raw-1');
    expect(first.kind).toBe('awaitingConfirmation');
    const done = await servers.fileWriteProtected('fixture-survival', 'ops.json', next, file.sha256, first.confirmationToken, 'raw-1');
    expect(done).toMatchObject({ kind: 'applied', restartNeeded: true });
    await expect(servers.fileWriteProtected('fixture-survival', 'ops.json', '[]', file.sha256, null, 'raw-2')).rejects.toMatchObject({ code: 'stale_target' });
  });
});

const role = (id, rank) => ({ role: { id, name: id, rank, builtin: true, capabilities: [] }, expiresAtMs: null });
const person = (id, roleId, rank) => ({ id, displayName: id, minecraftAccounts: [], roles: [role(roleId, rank)], rank, deviceCount: 0, version: 'v' });
const device = (id, userId, extra = {}) => ({ id, name: id, revoked: false, current: false, userId, userName: userId, lastSeenAtMs: 0, ...extra });

describe('[access] grouping', () => {
  const users = [person('zoe', 'moderator', 40), person('me', 'owner', 100), person('pat', 'pack-user', 10), person('ann', 'player', 5), person('cus', 'builders', 30)];
  const devices = [
    device('pat-pc', 'pat'), device('me-laptop', 'me', { lastSeenAtMs: 5 }), device('me-here', 'me', { current: true }),
    device('me-old', 'me', { revoked: true, lastSeenAtMs: 9 }), device('ghost', 'gone-user', { userName: 'Ghost' }),
  ];
  test('management roles (including custom ones) are people; pack/player/public fold into pack users', () => {
    expect(isManagement(person('x', 'builders', 30))).toBe(true);
    expect(isManagement(person('x', 'pack-user', 10))).toBe(false);
    const groups = groupAccess(users, devices);
    expect(groups.people.map((entry) => entry.key)).toEqual(['me', 'zoe', 'cus']);
    expect(groups.packUsers.map((entry) => entry.key)).toEqual(['ann', 'pat']);
  });
  test('devices nest under their person: this device first, active before revoked, then most recent', () => {
    const me = groupAccess(users, devices).people[0];
    expect(me.self).toBe(true);
    expect(me.devices.map((entry) => entry.id)).toEqual(['me-here', 'me-laptop', 'me-old']);
    expect(groupAccess(users, devices).packUsers[1].devices.map((entry) => entry.id)).toEqual(['pat-pc']);
  });
  test('devices whose person is not listed still show, grouped by name', () => {
    expect(groupAccess(users, devices).others).toMatchObject([{ key: 'device-owner:Ghost', user: null, name: 'Ghost' }]);
    // Without principals.view there is no user list: everything groups by device owner.
    expect(groupAccess(undefined, devices).others.map((entry) => entry.name)).toEqual(['me', 'Ghost', 'pat']);
  });
  test('only your own active devices can be renamed; names are 1–64 printable characters', () => {
    expect(renamable(devices[1], devices)).toBe(true);
    expect(renamable(devices[3], devices)).toBe(false);
    expect(renamable(devices[0], devices)).toBe(false);
    expect(deviceNameProblem('  ')).toBe('empty');
    expect(deviceNameProblem('x'.repeat(65))).toBe('long');
    expect(deviceNameProblem('a\tb')).toBe('invalid');
    expect(deviceNameProblem('Travel laptop')).toBeNull();
    expect(sortDevices([device('b', 'u'), device('a', 'u')]).map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});


describe('[world] submitted datapack reconciliation', () => {
  const entry = { operationId: 'op', enabled: true, generation: 'g1' };
  const pack = { id: 'file/pack', state: 'disabled' };
  const done = { operationId: 'op', state: 'succeeded', reconciling: false };
  test('a completed command keeps its requested state through stale saved observations', () => {
    // Repeated reads, including those well after the former six-second timeout, remain stale.
    for (let reads = 0; reads < 20; reads++) expect(retainDatapackIntent(entry, pack, 'g1', done)).toBe(true);
    expect(retainDatapackIntent(entry, { ...pack, state: 'enabled' }, 'g1', done)).toBe(false);
  });
  test('a matching save cannot retire an operation still running or reconciling', () => {
    const enabled = { ...pack, state: 'enabled' };
    expect(retainDatapackIntent(entry, enabled, 'g1', undefined)).toBe(true);
    expect(retainDatapackIntent(entry, enabled, 'g1', { ...done, state: 'running' })).toBe(true);
    expect(retainDatapackIntent(entry, enabled, 'g1', { ...done, reconciling: true })).toBe(true);
  });
  test('terminal feedback survives global operation eviction without relocking the switch', () => {
    const settled = settleDatapackIntent(entry, done);
    expect(settled.terminal).toEqual({ step: 'done' });
    expect(settleDatapackIntent(settled, undefined)).toBe(settled);
    expect(retainDatapackIntent(settled, pack, 'g1', undefined)).toBe(true);
    expect(retainDatapackIntent(settled, { ...pack, state: 'enabled' }, 'g1', undefined)).toBe(false);
    expect(settleDatapackIntent(entry, { ...done, state: 'failed' }).terminal.step).toBe('failed');
  });
  test('retention ends when the pack disappears or game generation changes', () => {
    expect(retainDatapackIntent(entry, undefined, 'g1', done)).toBe(false);
    expect(retainDatapackIntent(entry, pack, 'g2', done)).toBe(false);
    expect(retainDatapackIntent(entry, pack, null, done)).toBe(false);
    // A failed command remains as feedback, with shownEnabled already using saved state.
    expect(toggleFeedback({ ...done, state: 'failed' }).step).toBe('failed');
  });
});

describe('[protected files] deferred leave and renewed confirmation', () => {
  test('expiry preserves reviewed text and validator but requires a new confirmation', () => {
    const expired = { step: 'confirm', text: 'reviewed', expected: 'sha', token: 'old', expiresAtMs: 10 };
    const preparing = protectedEditReducer(expired, { type: 'confirm', nowMs: 11 });
    expect(preparing).toEqual({ step: 'preparing', text: 'reviewed', expected: 'sha' });
    const renewed = protectedEditReducer(preparing, { type: 'prepared', token: 'new', expiresAtMs: 100 });
    expect(renewed.step).toBe('confirm');
    expect(protectedEditSends(renewed)).toBe(false);
    expect(protectedEditReducer(renewed, { type: 'confirm', nowMs: 12 }).token).toBe('new');
  });
  test('a route or Back destination resumes only on applied, never preparation, expiry or cancellation', () => {
    for (const destination of ['/servers/another/overview', 'close']) {
      for (const event of [{ type: 'prepared', token: 't', expiresAtMs: 9 }, { type: 'expired' }, { type: 'cancel' }, { type: 'failed' }, { type: 'stale' }]) {
        expect(protectedLeaveDestination(destination, event)).toBeNull();
      }
      expect(protectedLeaveDestination(destination, { type: 'applied' })).toBe(destination);
    }
    expect(protectedLeaveDestination(null, { type: 'applied' })).toBeNull();
  });
});
