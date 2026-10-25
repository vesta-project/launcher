import { describe, expect, test } from 'bun:test';
import { createFixtureServers } from '../src/features/servers/fixtures';
import { defaultBackupProfile } from '../src/features/servers/native-backups-config';

describe('backup configuration from an unconfigured launcher connection', () => {
  test('setup, edit, delete and retries keep the authoritative flag accurate', async () => {
    const api = createFixtureServers({ latencyMs: 0, backupsConfigured: false });
    const id = 'fixture-survival';
    const initial = await api.backupConfiguration(id);
    expect(initial).toMatchObject({ profiles: [], revision: null, backupsConfigured: false, repository: { initialized: false }, scheduleOwner: 'automation' });
    const draft = { profiles: [defaultBackupProfile()], limits: initial.limits, initializeRepository: true };
    expect(await api.backupConfigure(id, draft, null, 'setup')).toEqual({ revision: 1 });
    expect(await api.backupConfigure(id, draft, null, 'setup')).toEqual({ revision: 1 });
    expect(await api.backupConfiguration(id)).toMatchObject({ revision: 1, backupsConfigured: true, repository: { initialized: true } });
    expect((await api.backups(id, null)).profiles).toHaveLength(1);
    const edited = { ...draft, initializeRepository: false, profiles: [{ ...draft.profiles[0], keepDaily: 14, exclude: ['logs/'] }] };
    await expect(api.backupConfigure(id, edited, null, 'stale')).rejects.toMatchObject({ code: 'stale_target' });
    await expect(api.backupConfigure(id, edited, 1, 'setup')).rejects.toMatchObject({ code: 'conflict' });
    await api.backupConfigure(id, edited, 1, 'edit');
    expect((await api.backupConfiguration(id)).profiles[0]).toMatchObject({ keepDaily: 14, exclude: ['logs/'] });
    await api.backupConfigure(id, { ...draft, profiles: [], initializeRepository: false }, 2, 'delete');
    await api.backupConfigure(id, draft, null, 'setup');
    expect(await api.backupConfiguration(id)).toMatchObject({ revision: 3, profiles: [], backupsConfigured: false, repository: { initialized: true } });
    expect((await api.snapshot(id)).backupsConfigured).toBe(false);
  });
  test('viewer cannot configure and traversal or invalid profiles are refused', async () => {
    const api = createFixtureServers({ latencyMs: 0 });
    await expect(api.backupConfiguration('fixture-creative')).rejects.toMatchObject({ code: 'forbidden' });
    const view = await api.backupConfiguration('fixture-survival');
    const draft = { profiles: [{ ...defaultBackupProfile(), include: ['../private-state'] }], limits: view.limits, initializeRepository: true };
    await expect(api.backupConfigure('fixture-survival', draft, null, 'bad')).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await api.backupConfiguration('fixture-survival')).revision).toBeNull();
  });
});
