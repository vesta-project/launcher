// Contract for server management beyond lifecycle: backups, access (users, roles,
// devices, invitations, access sources) and the hosted modpack. Same rules as
// `native.ts`: camelCase DTOs, opaque ids and cursors stay strings, mutations take a
// UI `intentId`, rejections use the closed `ServerCommandError`.
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

// ------------------------------------------------------------------ backups

export interface BackupProfile {
  name: string;
  mode: 'online' | 'stopped';
  keepTotal?: number | null;
  keepHourly?: number | null;
  keepLast: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  onMutation: 'warn' | 'fail-world' | 'fail-any';
  warnSeconds: number;
  maxSnapshots: number | null;
}

export type BackupJobKind = 'backup' | 'verify' | 'restore' | 'restore_in_place';
export type BackupJobState = 'awaiting_confirmation' | 'queued' | 'running' | 'succeeded' | 'failed' | 'uncertain' | 'recovery_required';

export interface BackupJob {
  id: string;
  profile: string;
  kind: BackupJobKind;
  state: BackupJobState;
  /** Display name of who asked, when the agent can resolve it. */
  requestedBy: string | null;
  snapshotId: string | null;
  /** Fixed safe code, e.g. `backup_disk_space_low`. */
  errorCode: string | null;
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  result: {
    filesNew?: number; filesChanged?: number; filesUnmodified?: number;
    dataAdded?: number; totalBytesProcessed?: number;
    consistency?: 'world_save_consistent' | 'stopped';
    worldChanged?: boolean; verified?: boolean;
    filesWritten?: number; filesRemoved?: number; safetySnapshotId?: string | null;
  } | null;
}

export interface BackupSnapshot { id: string; time: string; safety: boolean }

export interface BackupOverview {
  profiles: BackupProfile[];
  jobs: BackupJob[];
  nextBefore: string | null;
  /** A failed in-place restore blocks starts until resolved. */
  recoveryRequired: boolean;
}

export interface BackupStorage {
  repositoryBytes: number;
  restorePoints: number;
  safetySnapshots: number;
  freeBytes: number | null;
  limits: { maxSnapshots: number | null; maxRepositoryBytes: number | null; minFreeBytes: number };
  stopped: 'backup_snapshot_limit_reached' | 'backup_storage_limit_reached' | 'backup_disk_space_low' | null;
}

// ------------------------------------------------------------------ access

export interface RoleSummary { id: string; name: string; rank: number; builtin: boolean; capabilities: { capability: string; scope: string }[] }

export interface ServerUser {
  id: string;
  displayName: string;
  minecraftAccounts: { uuid: string; name: string | null }[];
  roles: { role: RoleSummary; expiresAtMs: number | null }[];
  rank: number;
  deviceCount: number;
  /** Opaque optimistic-concurrency token for role changes. */
  version: string;
}

export interface ServerDevice {
  id: string;
  name: string;
  revoked: boolean;
  /** The device this launcher is using. */
  current: boolean;
  userId: string | null;
  userName: string | null;
  lastSeenAtMs: number | null;
}

export interface Invitation {
  id: string | null;
  role: RoleSummary | { id: string; name: string; rank: number };
  createdAtMs: number | null;
  expiresAtMs: number;
  createdBy: string | null;
}

/** Shown once, when the invitation is created. */
export interface IssuedInvitation { id: string | null; code: string; pairingLink: string | null; role: string; expiresAtMs: number }

export interface AccessSources {
  /** Role ids for each automatic source. */
  anonymous: string;
  newUser: string;
  whitelist: string;
  whitelistEnabled: boolean;
  password: string;
  version: string;
}

// ------------------------------------------------------------------ pack

export interface PackOutcome { hostedRevision: string; minimumRevision: string }

// ------------------------------------------------------------------ commands

export const serversManageNative = {
  /** GET backups (+ optional `before` cursor). */
  backups: (connectionId: ConnectionId, before: string | null) => call<BackupOverview>('server_backups', { connectionId, before }),
  /** GET backups/snapshots and backups/safety-snapshots for one profile, newest first. */
  backupSnapshots: (connectionId: ConnectionId, profile: string) => call<BackupSnapshot[]>('server_backup_snapshots', { connectionId, profile }),
  backupStorage: (connectionId: ConnectionId, refresh = false) => call<BackupStorage>('server_backup_storage', { connectionId, refresh }),
  /** POST backups/run → the accepted job. */
  backupRun: (connectionId: ConnectionId, profile: string, intentId: string) => call<BackupJob>('server_backup_run', { connectionId, profile, intentId }),
  backupVerify: (connectionId: ConnectionId, profile: string, intentId: string) => call<BackupJob>('server_backup_verify', { connectionId, profile, intentId }),
  /** POST backups/restore: inspection-only copy into the restore folder; never touches the live server. */
  backupRestoreCopy: (connectionId: ConnectionId, profile: string, snapshot: string, paths: string[], intentId: string) =>
    call<BackupJob>('server_backup_restore_copy', { connectionId, profile, snapshot, paths, intentId }),
  /**
   * POST backups/restore-in-place: prepares and returns the job awaiting confirmation;
   * native keeps the token. The game must be stopped. Never retried automatically.
   */
  backupRestorePrepare: (connectionId: ConnectionId, profile: string, snapshot: string, paths: string[], skipSafetySnapshot: boolean, intentId: string) =>
    call<{ job: BackupJob; expiresAtMs: number }>('server_backup_restore_prepare', { connectionId, profile, snapshot, paths, skipSafetySnapshot, intentId }),
  /** POST backups/jobs/{id}/confirm with the token native kept. */
  backupRestoreConfirm: (connectionId: ConnectionId, jobId: string) => call<BackupJob>('server_backup_restore_confirm', { connectionId, jobId }),
  /** POST backups/jobs/{id}/resolve-recovery: accept the current files as they are. */
  backupResolveRecovery: (connectionId: ConnectionId, jobId: string) => call<BackupJob>('server_backup_resolve_recovery', { connectionId, jobId }),

  /** GET users (offset paging). */
  users: (connectionId: ConnectionId, offset: number) => call<{ users: ServerUser[]; nextOffset: number | null }>('server_users', { connectionId, offset }),
  roles: (connectionId: ConnectionId) => call<RoleSummary[]>('server_roles', { connectionId }),
  /** PUT users/{id}/roles. */
  userRoles: (connectionId: ConnectionId, userId: string, add: string[], remove: string[], expectedVersion: string, intentId: string) =>
    call<ServerUser>('server_user_roles', { connectionId, userId, add, remove, expectedVersion, intentId }),
  /** GET devices (or users/{id}/devices on older agents). */
  devices: (connectionId: ConnectionId) => call<ServerDevice[]>('server_devices', { connectionId }),
  /** DELETE devices/{id}. */
  revokeDevice: (connectionId: ConnectionId, deviceId: string, intentId: string) => call<void>('server_device_revoke', { connectionId, deviceId, intentId }),
  /** GET invitations (agents without the route return `unsupported`). */
  invitations: (connectionId: ConnectionId) => call<Invitation[]>('server_invitations', { connectionId }),
  /** POST invitations: the code is returned once and never stored by the launcher. */
  createInvitation: (connectionId: ConnectionId, roleId: string, expiresMinutes: number, intentId: string) =>
    call<IssuedInvitation>('server_invitation_create', { connectionId, roleId, expiresMinutes, intentId }),
  revokeInvitation: (connectionId: ConnectionId, invitationId: string, intentId: string) =>
    call<void>('server_invitation_revoke', { connectionId, invitationId, intentId }),
  accessSources: (connectionId: ConnectionId) => call<AccessSources>('server_access_sources', { connectionId }),
  /** PATCH access-sources; only the fields given change. */
  updateAccessSources: (connectionId: ConnectionId, patch: Partial<Omit<AccessSources, 'version'>>, expectedVersion: string, intentId: string) =>
    call<AccessSources>('server_access_sources_update', { connectionId, patch, expectedVersion, intentId }),

  /** POST pack/publish with the expected hosted revision ("0" when unpublished). */
  packPublish: (connectionId: ConnectionId, expectedRevision: string, intentId: string) => call<PackOutcome>('server_pack_publish', { connectionId, expectedRevision, intentId }),
  /** POST pack/minimum: raise the minimum required revision (never lowers). */
  packMinimum: (connectionId: ConnectionId, expectedRevision: string, minimumRevision: string, intentId: string) =>
    call<PackOutcome>('server_pack_minimum', { connectionId, expectedRevision, minimumRevision, intentId }),
};
