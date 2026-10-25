// Backup setup remains reachable when snapshot.backupsConfigured is false.
// `backups.configure` is owner/administrator-reserved and cannot be delegated remotely.
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';
import type { BackupProfile, BackupStorage } from './native-manage';

export interface BackupProfileConfig extends BackupProfile {
  /** Literal paths relative to the game root. Empty means the whole game, including worlds and configs. */
  include: string[];
  /** Additional gitignore-style exclusions; applied after .vesta-backupignore. */
  exclude: string[];
}
export interface BackupConfigDraft {
  /** Complete replacement: add, edit, rename, or remove entries. [] disables backups; snapshots stay stored. */
  profiles: BackupProfileConfig[];
  limits: BackupStorage['limits'];
  initializeRepository: boolean;
}
export interface BackupConfiguration {
  source: 'host_config' | 'stored';
  revision: number | null;
  profiles: BackupProfileConfig[];
  limits: BackupStorage['limits'];
  repository: { kind: 'local' | 's3'; location: string | null; initialized: boolean };
  backupsConfigured: boolean;
  scheduleOwner: 'automation';
}
export interface BackupConfigOutcome { revision: number }

/** Safe wizard defaults include every world (including custom level-name) and all game configs. */
export const defaultBackupProfile = (name = 'daily'): BackupProfileConfig => ({
  name, mode: 'stopped', keepLast: 7, keepDaily: 7, keepWeekly: 4, keepMonthly: 3,
  onMutation: 'fail-world', warnSeconds: 60, maxSnapshots: null, include: [], exclude: [],
});
export const serversBackupsConfigNative = {
  backupConfiguration: (connectionId: ConnectionId) => invoke<BackupConfiguration>('server_backup_configuration', { connectionId }),
  /** Saves the complete set with optimistic concurrency. Reuse intentId only for the identical retry. */
  backupConfigure: (connectionId: ConnectionId, draft: BackupConfigDraft, expectedRevision: number | null, intentId: string) =>
    invoke<BackupConfigOutcome>('server_backup_configure', { connectionId, draft, expectedRevision, intentId }),
};
