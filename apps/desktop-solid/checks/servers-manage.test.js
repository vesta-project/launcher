import { describe, expect, test } from 'bun:test';
import { createFixtureServers } from '../src/features/servers/fixtures';

const api = () => createFixtureServers({ latencyMs: 0 });
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('[access] delegation stays below the caller', () => {
  test('owners can change lower roles but never grant Owner or Administrator remotely', async () => {
    const servers = api();
    const { users } = await servers.users('fixture-survival', 0);
    const kai = users.find((user) => user.displayName === 'Kai_builds');
    const updated = await servers.userRoles('fixture-survival', kai.id, ['maintainer'], ['moderator'], kai.version, 'i1');
    expect(updated.roles.map((entry) => entry.role.id)).toEqual(['maintainer']);
    await expect(servers.userRoles('fixture-survival', kai.id, ['administrator'], [], updated.version, 'i2')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(servers.userRoles('fixture-survival', kai.id, ['viewer'], [], kai.version, 'i3')).rejects.toMatchObject({ code: 'stale_target' });
  });
  test('a viewer cannot see people at all', async () => {
    await expect(api().users('fixture-creative', 0)).rejects.toMatchObject({ code: 'forbidden' });
  });
  test('invitations: code shown once, below-rank roles only, revocable, bounded expiry', async () => {
    const servers = api();
    const issued = await servers.createInvitation('fixture-survival', 'moderator', 30, 'i4');
    expect(issued.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.pairingLink).toContain(issued.code);
    const listed = await servers.invitations('fixture-survival');
    expect(JSON.stringify(listed)).not.toContain(issued.code);
    await expect(servers.createInvitation('fixture-survival', 'owner', 30, 'i5')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(servers.createInvitation('fixture-survival', 'viewer', 120, 'i6')).rejects.toMatchObject({ code: 'invalid_input' });
    await servers.revokeInvitation('fixture-survival', issued.id, 'i7');
    expect((await servers.invitations('fixture-survival')).some((entry) => entry.id === issued.id)).toBe(false);
  });
  test('join rules only accept public/pack roles and need the current version', async () => {
    const servers = api();
    const sources = await servers.accessSources('fixture-survival');
    await expect(servers.updateAccessSources('fixture-survival', { anonymous: 'maintainer' }, sources.version, 'i8')).rejects.toMatchObject({ code: 'forbidden' });
    const next = await servers.updateAccessSources('fixture-survival', { anonymous: 'player', whitelistEnabled: false }, sources.version, 'i9');
    expect(next).toMatchObject({ anonymous: 'player', whitelistEnabled: false });
    await expect(servers.updateAccessSources('fixture-survival', { anonymous: 'public' }, sources.version, 'i10')).rejects.toMatchObject({ code: 'stale_target' });
  });
  test('this device cannot revoke itself', async () => {
    const servers = api();
    const devices = await servers.devices('fixture-survival');
    await expect(servers.revokeDevice('fixture-survival', devices.find((device) => device.current).id, 'i11')).rejects.toMatchObject({ code: 'invalid_input' });
    await servers.revokeDevice('fixture-survival', 'd-laptop', 'i12');
    expect((await servers.devices('fixture-survival')).find((device) => device.id === 'd-laptop').revoked).toBe(true);
  });
});

describe('[backups] restores are explicit and safe', () => {
  test('in-place restore needs a stopped server and a confirmation', async () => {
    const servers = api();
    const [point] = await servers.backupSnapshots('fixture-survival', 'daily');
    await expect(servers.backupRestorePrepare('fixture-survival', 'daily', point.id, [], false, 'r1')).rejects.toMatchObject({ code: 'stale_target' });
    const stopped = await servers.backups('fixture-creative', null).catch((error) => error);
    expect(stopped).toMatchObject({ code: 'forbidden' });
  });
  test('a stopped-only profile refuses to back up a running server; online backups produce a restore point', async () => {
    const servers = api();
    const failing = await servers.backupRun('fixture-survival', 'before-updates', 'b1');
    await settle(700);
    const after = await servers.backups('fixture-survival', null);
    expect(after.jobs.find((job) => job.id === failing.id)).toMatchObject({ state: 'failed', errorCode: 'backup_requires_stopped_server' });
    const before = (await servers.backupSnapshots('fixture-survival', 'daily')).length;
    await servers.backupRun('fixture-survival', 'daily', 'b2');
    await settle(2600);
    expect((await servers.backupSnapshots('fixture-survival', 'daily')).length).toBe(before + 1);
  });
});

describe('[pack] revisions only move forward', () => {
  test('publish needs the current revision and the minimum can be raised but never lowered', async () => {
    const servers = api();
    await expect(servers.packPublish('fixture-survival', '3', 'p1')).rejects.toMatchObject({ code: 'stale_target' });
    const published = await servers.packPublish('fixture-survival', '14', 'p2');
    expect(published.hostedRevision).toBe('15');
    await expect(servers.packMinimum('fixture-survival', '15', '11', 'p3')).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await servers.packMinimum('fixture-survival', '15', '15', 'p4')).minimumRevision).toBe('15');
  });
});
