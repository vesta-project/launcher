import { describe, expect, test } from 'bun:test';
import { createFixtureServers } from '../src/features/servers/fixtures';

// The browser fixture follows the native contract's semantics, so previews and
// these checks exercise the same flows the UI drives against a real agent.
const api = () => createFixtureServers({ latencyMs: 0 });
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CODE = 'A'.repeat(43);

describe('[pairing] connect flow', () => {
  test('discover returns an unverified identity and a pairing link pre-fills code and fingerprint', async () => {
    const servers = api();
    const plain = await servers.discover('play.example.net');
    expect(plain).toMatchObject({ endpoint: 'play.example.net:8443', expectedFingerprint: null, linkCode: null });
    const link = `vesta://pair?endpoint=${encodeURIComponent('https://play.example.net')}&code=${CODE}&fp=${plain.fingerprint}&sid=srv_x`;
    expect(await servers.discover(link)).toMatchObject({ expectedFingerprint: plain.fingerprint, linkCode: CODE, serverId: 'srv_x' });
  });
  test('invalid addresses and unreachable hosts reject with closed codes', async () => {
    const servers = api();
    await expect(servers.discover('http://nope')).rejects.toMatchObject({ code: 'invalid_address' });
    await expect(servers.discover('offline.example')).rejects.toMatchObject({ code: 'unreachable' });
  });
  test('pairing saves a connection; bad and lost codes are distinct and never auto-retried', async () => {
    const servers = api();
    const found = await servers.discover('new.example');
    await expect(servers.pair(found.discoveryId, 'short')).rejects.toMatchObject({ code: 'pair_code_invalid' });
    await expect(servers.pair(found.discoveryId, `lost${'A'.repeat(39)}`)).rejects.toMatchObject({ code: 'pair_outcome_unknown' });
    const snapshot = await servers.pair(found.discoveryId, CODE);
    expect(snapshot.connection).toMatchObject({ endpoint: 'new.example:8443', role: 'owner', fingerprint: found.fingerprint });
    expect((await servers.list()).some((entry) => entry.connection.id === snapshot.connection.id)).toBe(true);
  });
  test('Minecraft sign-in without an owner link grants no management access', async () => {
    const servers = api();
    const found = await servers.discover('mc.example');
    const snapshot = await servers.signInMinecraft(found.discoveryId, 'uuid');
    expect(snapshot.state.access).toBe('no_management_access');
    expect(snapshot.capabilities.granted).not.toContain('status.view');
  });
});

describe('[lifecycle] generation-bound operations', () => {
  test('stop with a stale generation is refused; a viewer is forbidden and the refusal is remembered', async () => {
    const servers = api();
    await expect(servers.lifecycle('fixture-survival', 'stop', 'stale', 'i1')).rejects.toMatchObject({ code: 'stale_target' });
    await expect(servers.lifecycle('fixture-creative', 'start', null, 'i2')).rejects.toMatchObject({ code: 'forbidden' });
    const viewer = await servers.snapshot('fixture-creative');
    expect(viewer.capabilities.refused).toContain('lifecycle.start');
  });
  test('stop is accepted (queued), the game passes through stopping, and force kill needs prepare then confirm', async () => {
    const servers = api();
    const before = await servers.snapshot('fixture-survival');
    const operation = await servers.lifecycle('fixture-survival', 'stop', before.status.generation, 'i3');
    expect(operation.state).toBe('queued');
    const stopping = await servers.snapshot('fixture-survival');
    expect(stopping.status.state).toBe('stopping');
    await expect(servers.killConfirm('fixture-survival', 'never-prepared')).rejects.toMatchObject({ code: 'conflict' });
    const prepared = await servers.killPrepare('fixture-survival', stopping.status.generation, 'k1');
    expect(prepared.expiresAtMs).toBeGreaterThan(Date.now());
    const killed = await servers.killConfirm('fixture-survival', 'k1');
    expect(killed.intent).toBe('lifecycle.kill');
    await settle(900);
    expect((await servers.snapshot('fixture-survival')).status).toMatchObject({ state: 'stopped', generation: null });
  });
  test('a retried stop with the same intent replays its operation instead of stopping twice', async () => {
    const servers = api();
    const generation = (await servers.snapshot('fixture-survival')).status.generation;
    const first = await servers.lifecycle('fixture-survival', 'stop', generation, 'stop-once');
    const retry = await servers.lifecycle('fixture-survival', 'stop', generation, 'stop-once');
    expect(retry.operationId).toBe(first.operationId);
    expect((await servers.operations('fixture-survival', null)).items.filter((operation) => operation.intent === 'lifecycle.stop' && operation.state !== 'succeeded')).toHaveLength(1);
  });
  test('a prepared kill cannot be confirmed once its run has already stopped', async () => {
    const servers = api();
    const generation = (await servers.snapshot('fixture-survival')).status.generation;
    await servers.lifecycle('fixture-survival', 'stop', generation, 'stop-k');
    await servers.killPrepare('fixture-survival', generation, 'late-kill');
    await settle(3700);
    await expect(servers.killConfirm('fixture-survival', 'late-kill')).rejects.toMatchObject({ code: 'stale_target' });
  });
  test('an unreachable server rejects actions instead of pretending', async () => {
    const servers = api();
    await expect(servers.lifecycle('fixture-away', 'stop', 'x', 'i4')).rejects.toMatchObject({ code: 'unreachable' });
  });
});

describe('[console] commands and history', () => {
  test('a sent command is an operation and is echoed on the console stream', async () => {
    const servers = api();
    const generation = (await servers.snapshot('fixture-survival')).status.generation;
    const received = [];
    const close = await servers.subscribe('fixture-survival', 'console', (event) => received.push(event));
    expect(received[0]).toMatchObject({ kind: 'console' });
    const operation = await servers.consoleSend('fixture-survival', 'say hi', generation, 'c1');
    expect(operation.intent).toBe('console.command');
    await settle(300);
    expect(received.some((event) => event.kind === 'console' && event.lines.some((line) => line.text.includes('say hi')))).toBe(true);
    close();
  });
  test('console pages read the retained tail, then continue forward like the agent', async () => {
    const servers = api();
    const tail = await servers.consolePage('fixture-survival', null, 10);
    expect(tail.items).toHaveLength(10);
    expect(tail.items.at(-1).cursor).toBe(tail.latestCursor);
    const middle = await servers.consolePage('fixture-survival', tail.items[0].cursor, 3);
    expect(middle.items.map((line) => line.cursor)).toEqual(tail.items.slice(1, 4).map((line) => line.cursor));
    expect(middle.nextCursor).toBe(middle.items.at(-1).cursor);
  });
  test('a retried command with the same intent is one operation; a changed payload conflicts', async () => {
    const servers = api();
    const generation = (await servers.snapshot('fixture-survival')).status.generation;
    const first = await servers.consoleSend('fixture-survival', 'say once', generation, 'same-intent');
    const retry = await servers.consoleSend('fixture-survival', 'say once', generation, 'same-intent');
    expect(retry.operationId).toBe(first.operationId);
    await expect(servers.consoleSend('fixture-survival', 'say twice', generation, 'same-intent')).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('[players] typed moderation', () => {
  test('kick removes the player; OP requires confirmation of the same intent', async () => {
    const servers = api();
    const generation = (await servers.snapshot('fixture-survival')).status.generation;
    const kick = await servers.moderate('fixture-survival', { action: 'kick', player: 'Alex' }, generation, 'm1');
    expect(kick.kind).toBe('operation');
    const players = await servers.players('fixture-survival');
    expect(players.known && players.names).not.toContain('Alex');
    const op = await servers.moderate('fixture-survival', { action: 'op', player: 'Kai_builds' }, generation, 'm2');
    expect(op.kind).toBe('awaitingConfirmation');
    expect((await servers.operators('fixture-survival')).some((entry) => entry.name === 'Kai_builds')).toBe(false);
    await servers.moderateConfirm('fixture-survival', 'm2');
    expect((await servers.operators('fixture-survival')).some((entry) => entry.name === 'Kai_builds')).toBe(true);
  });
  test('a stopped game reports players as unknown, not zero', async () => {
    const servers = api();
    expect(await servers.players('fixture-creative')).toEqual({ known: false });
    const owner = await servers.discover('fresh.example');
    const paired = await servers.pair(owner.discoveryId, CODE);
    expect(await servers.players(paired.connection.id)).toEqual({ known: false });
  });
});

describe('[connections] local records', () => {
  test('pin, rename and remove only change launcher state', async () => {
    const servers = api();
    const changes = [];
    servers.onChanged(() => changes.push(1));
    expect((await servers.update('fixture-creative', { pinned: true, name: 'Builders' })).connection).toMatchObject({ pinned: true, name: 'Builders' });
    await servers.remove('fixture-creative');
    await expect(servers.snapshot('fixture-creative')).rejects.toMatchObject({ code: 'not_found' });
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('[credentials] no silent plaintext fallback', () => {
  test('without secure storage, pairing needs explicit session-only consent and keeps the code usable', async () => {
    const servers = api();
    const found = await servers.discover('novault.example');
    expect(found.secureStorageAvailable).toBe(false);
    await expect(servers.pair(found.discoveryId, CODE)).rejects.toMatchObject({ code: 'credentials_unavailable' });
    const snapshot = await servers.pair(found.discoveryId, CODE, { memoryOnly: true });
    expect(snapshot.connection.memoryOnly).toBe(true);
  });
});
