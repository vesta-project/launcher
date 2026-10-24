import { describe, expect, test } from 'bun:test';
import { createFixtureServers } from '../src/features/servers/fixtures';
import {
  bindProblem, gameStopped, hasOwnKey, hostOf, isExactSeed, jobActive, jobPollDelay, launchSummary, mayOwn, portProblem,
  publicKeyProblem, reasonMessage, seedProblem, sftpLoopbackOnly, warningCopy, worldConfirmed,
} from '../src/features/servers/hosting-model';
import { visibleSections } from '../src/features/servers/shell-model';

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl rae@laptop';

async function stoppedOwner() {
  const servers = createFixtureServers({ latencyMs: 0 });
  const [survival] = (await servers.list()).filter((entry) => entry.connection.id === 'fixture-survival');
  await servers.lifecycle('fixture-survival', 'stop', survival.status.generation, 'stop-1');
  await settle(3_600);
  return servers;
}

describe('[world] seeds and confirmation', () => {
  test('seeds keep 64-bit precision as strings; blank means random', () => {
    expect(isExactSeed('-4172144997902289642')).toBe(true);
    expect(isExactSeed('9223372036854775807')).toBe(true);
    expect(isExactSeed('9223372036854775808')).toBe(false);
    expect(isExactSeed('glacier')).toBe(false);
    expect(seedProblem('')).toBeNull();
    expect(seedProblem('a\nb')).toBe('server-hosting.seed-invalid');
  });
  test('replacement needs the exact world name, untrimmed and case-sensitive', () => {
    expect(worldConfirmed('world', 'world')).toBe(true);
    expect(worldConfirmed('World', 'world')).toBe(false);
    expect(worldConfirmed('world ', 'world')).toBe(false);
  });
  test('world details expose dimensions and datapacks without a world creation command', async () => {
    const servers = createFixtureServers({ latencyMs: 0 }); const world = await servers.world('fixture-survival');
    expect(servers.worldNew).toBeUndefined(); expect(world.sizeComplete).toBe(true);
    expect(world.dimensions.find(d => d.id === 'nether').layout).toBe('split');
    expect(world.datapacks.some(p => p.kind === 'folder')).toBe(true); expect(world.datapacks.some(p => p.enabled === null)).toBe(true);
  });
});

describe('[software] review, apply and follow', () => {
  test('labels, job states and the bounded follow cadence', () => {
    expect(launchSummary({ software: 'paper', version: '1.21.4', build: 130, installationId: 'x' })).toBe('Paper 1.21.4 · build 130');
    expect(launchSummary({ software: null, version: null, build: null, installationId: 'original' })).toBeNull();
    expect(jobActive({ state: 'staging' })).toBe(true);
    expect(jobActive({ state: 'recovery_required' })).toBe(false);
    expect(jobPollDelay(0)).toBe(2_000);
    expect(jobPollDelay(50)).toBe(10_000);
    expect(warningCopy('something_new')).toBe('server-hosting.warning-other');
    expect(reasonMessage('server_install.storage_low')).toBe('server-hosting.reason-storage-low');
    expect(reasonMessage('world_metadata_invalid')).toBe('server-hosting.reason-world-metadata');
    expect(reasonMessage('unheard_of')).toBeNull();
  });
  test('the software section is owner-reserved once the role is known', () => {
    const caps = { source: 'role', granted: ['config.view', 'content.install'], refused: [] };
    const ids = (role) => visibleSections({ capabilities: caps, connection: { role } }).map((section) => section.id);
    expect(ids('owner')).toContain('software');
    expect(ids('maintainer')).not.toContain('software');
    expect(ids(null)).toContain('software');
    expect(mayOwn('Owner')).toBe(true);
  });
  test('apply needs a stopped server and an acknowledged, unexpired plan; the job advances to success', async () => {
    const running = createFixtureServers({ latencyMs: 0 });
    const early = await running.softwarePlan('fixture-survival', { software: 'fabric', version: '1.21.1' });
    await expect(running.softwareApply('fixture-survival', early.planId, true, false, 'a0')).rejects.toMatchObject({ reason: 'software_state_unavailable' });

    const servers = await stoppedOwner();
    const plan = await servers.softwarePlan('fixture-survival', { software: 'fabric', version: '1.21.1' });
    expect(plan.java.major).toBe(21);
    expect(plan).not.toHaveProperty('confirmationToken');
    await expect(servers.softwareApply('fixture-survival', plan.planId, false, false, 'a1')).rejects.toMatchObject({ code: 'invalid_input' });
    const job = await servers.softwareApply('fixture-survival', plan.planId, true, false, 'a2');
    expect(job.state).toBe('queued');
    await expect(servers.softwareApply('fixture-survival', plan.planId, true, false, 'a3')).rejects.toMatchObject({ code: 'confirmation_expired' });
    await settle(5_000);
    const [latest] = await servers.softwareJobs('fixture-survival');
    expect(latest).toMatchObject({ id: job.id, state: 'succeeded' });
    const state = await servers.software('fixture-survival');
    expect(state.current).toMatchObject({ software: 'fabric', version: '1.21.1' });
    expect(state.previous).toMatchObject({ software: 'paper' });
  }, 15_000);
  test('unsupported software is visible but cannot be planned', async () => {
    const servers = createFixtureServers({ latencyMs: 0 });
    const state = await servers.software('fixture-survival');
    expect(state.catalog.find((entry) => entry.software === 'forge')).toMatchObject({ automaticBackend: false, unavailableReason: 'provider_not_implemented' });
    await expect(servers.softwareVersions('fixture-survival', 'forge')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(servers.software('fixture-away')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('[sftp] off by default, public keys only, opened natively', () => {
  test('private keys and malformed keys never pass', () => {
    expect(publicKeyProblem(KEY)).toBeNull();
    expect(publicKeyProblem('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----')).toBe('private');
    expect(publicKeyProblem('PuTTY-User-Key-File-3: ssh-ed25519')).toBe('private');
    expect(publicKeyProblem('ssh-ed25519 short')).toBe('format');
    expect(publicKeyProblem(KEY.replace('ssh-ed25519', 'ssh-rsa'))).toBe('format');
    expect(publicKeyProblem('')).toBe('empty');
  });
  test('addresses and ports', () => {
    expect(hostOf('play.riverside.example:8443')).toBe('play.riverside.example');
    expect(hostOf('[2001:db8::42]:8443')).toBe('[2001:db8::42]');
    expect(hostOf('https://10.0.0.5:8443/x')).toBe('10.0.0.5');
    expect(portProblem('2222')).toBeNull();
    expect(portProblem('70000')).toBe('server-hosting.port-invalid');
    expect(bindProblem('0.0.0.0')).toBeNull();
    expect(bindProblem('::')).toBeNull();
    expect(bindProblem('example.com')).toBe('server-hosting.bind-invalid');
    expect(sftpLoopbackOnly({ config: { bindAddress: '127.0.0.1' } })).toBe(true);
    expect(sftpLoopbackOnly({ config: { bindAddress: '::1' } })).toBe(true);
    expect(sftpLoopbackOnly({ config: { bindAddress: '2001:db8::1' } })).toBe(false);
  });
  test('opening waits for the owner to enable it, then uses the trusted endpoint host', async () => {
    const servers = createFixtureServers({ latencyMs: 0 });
    const off = await servers.sftp('fixture-survival');
    expect(off).toMatchObject({ running: false, hostKeyFingerprint: null, config: { enabled: false } });
    await expect(servers.sftpOpen('fixture-survival')).rejects.toMatchObject({ reason: 'sftp_disabled' });
    const on = await servers.sftpUpdate('fixture-survival', { enabled: true, port: 2222, bindAddress: '0.0.0.0' }, 's1');
    expect(on.running).toBe(true);
    expect(on.hostKeyFingerprint).toMatch(/^SHA256:/);
    const target = await servers.sftpOpen('fixture-survival');
    expect(target).toMatchObject({ host: 'play.riverside.example', port: 2222, username: on.username });
  });
  test('keys: add, duplicate refused, revoke keeps the record', async () => {
    const servers = createFixtureServers({ latencyMs: 0 });
    const { username } = await servers.sftp('fixture-survival');
    expect(hasOwnKey(await servers.sftpKeys('fixture-survival'), username, Date.now())).toBe(false);
    const key = await servers.sftpKeyAdd('fixture-survival', username, '', KEY, null, 'k1');
    expect(key.label).toBe('rae@laptop');
    await expect(servers.sftpKeyAdd('fixture-survival', username, 'again', KEY, null, 'k2')).rejects.toMatchObject({ reason: 'sftp_key_duplicate' });
    expect(hasOwnKey(await servers.sftpKeys('fixture-survival'), username, Date.now())).toBe(true);
    await servers.sftpKeyRevoke('fixture-survival', key.id, 'k3');
    const keys = await servers.sftpKeys('fixture-survival');
    expect(keys[0].revokedAtMs).not.toBeNull();
    expect(hasOwnKey(keys, username, Date.now())).toBe(false);
    await expect(servers.sftpKeys('fixture-away')).rejects.toMatchObject({ code: 'forbidden' });
  });
  test('stopped-state helper needs a reachable agent', () => {
    expect(gameStopped({ state: { phase: 'online' }, status: { state: 'stopped' } })).toBe(true);
    expect(gameStopped({ state: { phase: 'backoff' }, status: { state: 'stopped' } })).toBe(false);
  });
});
