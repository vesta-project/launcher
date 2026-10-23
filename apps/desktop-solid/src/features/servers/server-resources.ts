// The cached reads the server workspace shares between tabs, prefetch and the shell.
import { toServerError } from './errors';
import { serverResource } from './resources';
import { loadOperations, serverCommand } from './store';
import type { BackupOverview, BackupStorage } from './native-manage';

/** Recent tasks; the operations topic keeps the store current after the first read. */
export const operationsResource = serverResource('operations', (id) => loadOperations(id));

export const whitelistResource = serverResource('whitelist', (id) => serverCommand((client) => client.whitelist(id)));
export const operatorsResource = serverResource('operators', (id) => serverCommand((client) => client.operators(id)));
export const bansResource = serverResource('bans', (id) => serverCommand((client) => client.bans(id)));

const NO_BACKUPS: BackupOverview = { profiles: [], jobs: [], nextBefore: null, recoveryRequired: false };

/** Backup profiles and recent jobs. A server without backups reads as an empty overview. */
export const backupsResource = serverResource('backups', async (id): Promise<BackupOverview> => {
  try { return await serverCommand((client) => client.backups(id, null)); }
  catch (reason) {
    if (toServerError(reason).code === 'backups_not_configured') return NO_BACKUPS;
    throw reason;
  }
});

/** Repository usage; optional, so a failure reads as unknown rather than an error. */
export const backupStorageResource = serverResource('backup-storage', (id): Promise<BackupStorage | null> =>
  serverCommand((client) => client.backupStorage(id, true)).catch(() => null));

/** Expanded restore points share the normal refresh and invalidation lifecycle. */
export const backupSnapshotsResource = serverResource('backup-snapshots', (id, profile: string) =>
  serverCommand((client) => client.backupSnapshots(id, profile)));

/** Player list resources, by the Players settings view that shows them. */
export const playerListResources = { whitelist: whitelistResource, ops: operatorsResource, bans: bansResource } as const;
