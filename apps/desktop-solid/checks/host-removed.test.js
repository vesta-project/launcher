import { expect, test } from 'bun:test';
import {
  biggestParts, formatStorage, hostHas, lifecycleProblem, purgeIn, retentionChoices, retentionDays, sortRemoved, volumeUse,
} from '../src/features/servers/host-removed';
import { createHostFixtures } from '../src/features/servers/host-fixtures';

const clock = { now: () => Date.parse('2026-11-21T00:00:00Z'), wait: async () => {} };

test('capabilities gate each part and older machines keep the 7 day default', () => {
  const info = { capabilities: ['removed-servers'], removedServerRetentionDays: 30 };
  expect(hostHas(info, 'removed-servers')).toBe(true);
  expect(hostHas(info, 'storage')).toBe(false);
  expect(hostHas(undefined, 'storage')).toBe(false);
  expect(retentionDays(info)).toBe(30);
  expect(retentionDays({ capabilities: [] })).toBe(7);
  expect(retentionChoices(7)).toEqual([1, 3, 7, 14, 30, 90, 365]);
  expect(retentionChoices(45)).toContain(45);
});

test('time left before the machine deletes a removed server', () => {
  const now = clock.now();
  expect(purgeIn(new Date(now + 2 * 86_400_000 + 3_600_000).toISOString(), now)).toEqual({ message: 'servers.age.days', count: 2 });
  expect(purgeIn(new Date(now + 5 * 3_600_000).toISOString(), now)).toEqual({ message: 'servers.age.hours', count: 5 });
  expect(purgeIn(new Date(now + 90_000).toISOString(), now)).toEqual({ message: 'servers.age.minutes', count: 2 });
  expect(purgeIn(new Date(now - 1).toISOString(), now)).toBeNull();
  expect(purgeIn('nonsense', now)).toBeNull();
});

test('restorable servers come first, soonest deadline first', () => {
  const at = (days) => new Date(clock.now() + days * 86_400_000).toISOString();
  const list = [
    { serverId: 'a', state: 'purging', restoreUntil: at(-1) },
    { serverId: 'b', state: 'restorable', restoreUntil: at(6) },
    { serverId: 'c', state: 'restorable', restoreUntil: at(2) },
  ];
  expect(sortRemoved(list).map((server) => server.serverId)).toEqual(['c', 'b', 'a']);
});

test('sizes and disk use read like a disk', () => {
  expect(formatStorage(512)).toBe('512 B');
  expect(formatStorage(820 * 1024 ** 2)).toBe('820 MB');
  expect(formatStorage(3.4 * 1024 ** 3)).toBe('3.4 GB');
  expect(formatStorage(null)).toBe('');
  const volume = { totalBytes: 100, freeBytes: 5, lowAt: 8 };
  expect(volumeUse(volume)).toEqual({ used: 95, fraction: 0.95, low: true });
  expect(biggestParts({ worlds: 5, backups: 9, content: 1, logs: 0, software: 0, trash: 0, other: 50 }))
    .toEqual([{ part: 'backups', bytes: 9 }, { part: 'worlds', bytes: 5 }]);
});

test('machine refusals map to one line each', () => {
  expect(lifecycleProblem({ code: 'invalid_input', reason: 'confirm_name_mismatch' })).toBe('name');
  expect(lifecycleProblem({ code: 'not_found', reason: 'gone' })).toBe('gone');
  expect(lifecycleProblem({ code: 'rate_limited' })).toBe('rate');
  expect(lifecycleProblem(new Error('boom'))).toBe('other');
});

test('fixture machine: remove keeps the server restorable, restore renames on a clash', async () => {
  const api = createHostFixtures({ hosts: 'servers' }, clock);
  const removed = await api.removedServers('host-people');
  expect(removed.servers.map((server) => server.name)).toEqual(['Old Survival', 'Lobby', 'Skyblock test']);
  const back = await api.restoreServer('host-people', removed.servers[1].serverId, 'key-1');
  expect(back).toMatchObject({ name: 'Lobby (restored)', gamePort: 25570 });
  // The same key answers with the same receipt.
  expect(await api.restoreServer('host-people', removed.servers[1].serverId, 'key-1')).toEqual(back);
  await expect(api.restoreServer('host-people', removed.servers[2].serverId, 'key-2')).rejects.toMatchObject({ reason: 'purging' });
  const info = await api.info('host-people');
  expect(info.removedServerRetentionDays).toBe(7);
  await api.update('host-people', { removedServerRetentionDays: 30 });
  expect((await api.info('host-people')).removedServerRetentionDays).toBe(30);
  await expect(api.update('host-people', { removedServerRetentionDays: 0 })).rejects.toMatchObject({ reason: 'invalid_request' });
  const storage = await api.storage('host-people');
  expect(storage.volumes.some((volume) => volumeUse(volume).low)).toBe(true);
});
