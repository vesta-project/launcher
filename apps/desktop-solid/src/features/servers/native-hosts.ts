// Native host-v1 IPC. Tokens and private keys stay native; revisions/cursors are strings.
import { invoke } from '@tauri-apps/api/core';
export interface ServerRef { hostId: string; serverId: string }
export const hostConnectionId = (ref: ServerRef) => `${ref.hostId}:${ref.serverId}`;
export interface VestaHost { id: string; name: string; fingerprint: string; endpoints: string[]; deviceId: string; keyReference: string; accountId: string; authRevision: string }
export interface HostDiscovery { hostId: string; name: string | null; fingerprint: string; address: string; state: 'claimed' | 'unclaimed' | null }
/** `newDeviceSignIn` is only sent to owners: `account` lets a new device sign in with its Minecraft account, `approval` needs a link code. */
/** `newDeviceSignIn` and `removedServerRetentionDays` are only sent to owners (the second by newer machines). */
export interface HostInfo { hostId: string; name: string; fingerprint: string; endpoints: unknown[]; authGeneration: string; capabilities: string[]; role: string; revision: string; newDeviceSignIn?: NewDeviceSignIn; removedServerRetentionDays?: number }
export type NewDeviceSignIn = 'account' | 'approval';
/** `name` is the last Minecraft name the machine verified for that account, or null. */
export interface HostOwner { accountId: string; role: 'primary_owner' | 'owner'; name: string | null }
export interface HostUpdate { name?: string; newDeviceSignIn?: NewDeviceSignIn; removedServerRetentionDays?: number }
/** `software`, `minecraftVersion` and `iconEtag` are absent on older machines; null means unknown or no icon. */
export interface HostServer { serverId: string; name: string; gamePort: number; state: string; role: string; software?: { kind: string; version: string | null } | null; minecraftVersion?: string | null; iconEtag?: string | null }
export interface HostDevice { deviceId: string; name: string; accountId: string; revoked: boolean; createdAt: string }
export interface LinkResult { linkId: string; state: string; requestHash: string; deviceId?: string }
/** A code the machine accepted. Pass the id to claim or link so the same exchange is reused. */
export interface CodeVerified { verificationId: string; hostId: string; name: string | null }
/** `looksLikeServer` and `remediationCommand` are absent on older machines. */
export interface Folder { name: string; kind: 'directory'; folderToken: string | null; readable: boolean; looksLikeServer?: boolean; remediationCommand?: string | null }
export interface FolderRoot { rootId: string; label: string; displayPath: string; readable: boolean }
export type FolderCheckStatus = 'ok' | 'permission_needed' | 'not_found' | 'not_directory' | 'protected';
export interface FolderCheck { path: string; status: FolderCheckStatus; folderToken: string | null; remediationCommand: string | null }
export interface ImportPlan { folderToken: string; name: string; gamePort: number | null; memoryMiB: number | null; launchChoice: { kind: 'jar' | 'java_argfile'; relativePath: string } | null; minecraftVersion: string | null }
export interface ImportApply { planId: string; confirmation: string; acknowledgedWarnings: string[]; eulaAccepted: true; sourceStoppedConfirmed: true }
export type ImportState = 'planning' | 'review' | 'applying' | 'ready' | 'starting' | 'online' | 'blocked' | 'failed' | 'cancelled' | 'interrupted';
export interface ImportJob { jobId: string; state: ImportState; phase: string; error: string | null; progress: { filesDone: number; filesTotal: number; bytesDone: number; bytesTotal: number }; review: ImportReview | null; serverId: string | null }
export interface ImportReview { planId: string; confirmation: string | null; expiresAt: string; blockers: string[]; warnings: string[]; source: { displayPath: string; snapshot: string; files: number; bytes: number }; detected: unknown; runtime: unknown; destination: { serverId: string; displayPath: string; freeBytes: number }; resources: { gamePort: number; memoryMiB: number }; processes: unknown[]; ports: unknown[]; inspection: unknown }
export type HostAction = 'info' | 'update' | 'owners' | 'devices' | 'link_code' | 'link_status' | 'link_approve' | 'device_revoke' | 'owner_promote' | 'owner_demote' | 'ownership_transfer' | 'folder_roots' | 'folder_resolve' | 'folder_list' | 'folder_check' | 'import_candidates' | 'import_inspect' | 'import_resources' | 'import_plan' | 'import_apply' | 'import_job' | 'import_cancel' | 'import_resume' | 'import_start' | 'import_readiness'
  | 'catalogue_minecraft' | 'catalogue_software' | 'create_defaults' | 'create_restore_sources' | 'create_plan' | 'create_apply' | 'create_job' | 'create_cancel' | 'create_resume' | 'create_start' | 'server_remove'
  | 'servers_removed' | 'server_restore' | 'server_purge' | 'storage' | 'storage_measure';
// Creating a server on the machine (create.md): new, from a modpack, or restored from a backup.
export interface CatalogueVersion { id: string; stable: boolean; experimental: boolean; recommended: boolean }
export interface MinecraftCatalogue { versions: CatalogueVersion[]; latestStable: string | null }
/** `id` is an opaque selection id; a plan sends `build` and `loaderVersion`. */
export interface CatalogueBuild { id: string; build: number | null; loaderVersion: string | null; stable: boolean; experimental: boolean; recommended: boolean }
export interface CatalogueKind { kind: string; label: string; stable: boolean; experimental: boolean; recommended: boolean; available: boolean; builds: CatalogueBuild[] }
export interface SoftwareCatalogue { minecraftVersion: string; kinds: CatalogueKind[] }
/** Nulls let the machine pick the recommended build. */
export interface CreateSoftware { kind: string; build: number | null; loaderVersion: string | null }
export interface CreateDefaults { name: string; minecraftVersion: string; software: CreateSoftware; gamePort: number; memoryMiB: number; java: 'automatic' }
export type CreateProvider = 'modrinth' | 'curseforge';
export type CreateSource = { kind: 'provider'; provider: CreateProvider; projectId: string; versionId: string } | { kind: 'snapshot'; sourceId: string } | { kind: 'upload'; uploadId: string };
interface CreateResources { name: string; gamePort: number | null; memoryMiB: number | null; eulaAccepted: false }
export type CreatePlan =
  | (CreateResources & { kind: 'new'; minecraftVersion: string; software: CreateSoftware })
  | (CreateResources & { kind: 'modpack'; source: CreateSource })
  | (CreateResources & { kind: 'restore'; source: CreateSource });
export interface CreateApply { planId: string; confirmation: string; acknowledgedWarnings: string[]; eulaAccepted: true }
export interface RestoreSource { sourceId: string; label: string; createdAt: string; minecraftVersion: string | null; software: { kind: string; version: string | null } | null; bytes: number }
export interface PackIssue { code: string; message: string; blocking: boolean }
export interface CreateSummary {
  kind: 'new' | 'modpack' | 'restore';
  name: string;
  minecraftVersion: string | null;
  software: { kind: string; version: string | null; build: number | null; loaderVersion: string | null } | null;
  resources: { gamePort: number; memoryMiB: number };
  runtime: { requiredMajor: number | null; downloadRequired: boolean; automatic: true } | null;
  destination: { serverId: string; displayPath: string; freeBytes: number };
  pack: { name: string; provider: string | null; projectId: string | null; versionId: string | null; minecraftVersion: string | null; loader: string | null; issues: PackIssue[] } | null;
  restore: { sourceId: string; label: string; createdAt: string } | null;
}
export interface CreateReview { planId: string; confirmation: string | null; expiresAt: string; summary: CreateSummary; blockers: string[]; warnings: string[] }
/** Same envelope and states as an import job; phases are `resolving`, `downloading_java`, `downloading_software`, `installing`, `registering`, `starting`. */
export interface CreateJob { jobId: string; state: ImportState; phase: string; error: string | null; progress: ImportJob['progress']; review: CreateReview | null; serverId: string | null }
/** The machine's receipt for a removed server; `restoreUntil` is when it can no longer be brought back. */
export interface ServerRemoved { serverId: string; removedAt: string; restoreUntil: string }
/** Deleting for good has started; `bytes` is what it frees, null until the machine has measured. */
export interface ServerPurging { serverId: string; purgeStartedAt: string; bytes: number | null }
/** A server waiting in the machine's retention window. */
export interface RemovedServer {
  serverId: string;
  name: string;
  removedAt: string;
  restoreUntil: string;
  removedBy: string | null;
  state: 'restorable' | 'restoring' | 'purging';
  bytes: number | null;
  minecraftVersion: string | null;
  software: { kind: string; version: string | null } | null;
}
/** The name and port a restored server came back with (both may differ from before). */
export interface ServerRestored { serverId: string; name: string; gamePort: number; restoredAt: string }
export interface StorageParts { worlds: number; backups: number; content: number; logs: number; software: number; trash: number; other: number }
export interface StorageVolume { volumeId: string; label: string; displayPath: string; totalBytes: number; freeBytes: number; holds: Array<'servers' | 'backups' | 'caches' | 'state'>; lowAt: number }
export interface ServerStorage { serverId: string; name: string; volumeId: string; bytes: number; parts: StorageParts }
export interface StorageCache { kind: 'java' | 'software_downloads' | 'catalogue' | 'pack_staging' | 'temp'; bytes: number; removable: boolean }
/** The machine's disk use, from its last background measurement. */
export interface HostStorage {
  measuredAt: string | null;
  measuring: boolean;
  volumes: StorageVolume[];
  servers: ServerStorage[];
  removed: { count: number; bytes: number };
  backups: { bytes: number; outsideServers: number };
  caches: StorageCache[];
  other: number;
}
export interface HostRequestOptions { id?: string; body?: unknown; revision?: string; idempotencyKey?: string }
const request = <T>(hostId: string, action: HostAction, options: HostRequestOptions = {}) => invoke<T>('host_request', { hostId, action, ...options });
export const hostsNative = {
  discover: () => invoke<HostDiscovery[]>('host_discover'),
  probe: (address: string) => invoke<HostDiscovery>('host_probe', { address }),
  list: () => invoke<VestaHost[]>('hosts_list'),
  remove: (hostId: string) => invoke<void>('host_remove', { hostId }),
  /** Runs the PAKE exchange for a complete code right away; the proven connection waits for claim or link. */
  verifyCode: (address: string, code: string, purpose: 'claim' | 'link') => invoke<CodeVerified>('host_verify_code', { address, code, purpose }),
  claim: (address: string, code: string, accountUuid: string, deviceName: string, verificationId: string | null = null) => invoke<VestaHost>('host_claim', { address, code, accountUuid, deviceName, verificationId }),
  signIn: (hostId: string) => invoke<HostInfo>('host_sign_in', { hostId }),
  /**
   * No code: signs this device in to a machine someone already set up, as this Minecraft account.
   * `hostId` is the machine that was picked. `deviceName` is a fallback; native sends the computer's name.
   */
  signInWithAccount: (address: string, hostId: string | null, accountUuid: string, deviceName: string) => invoke<VestaHost>('host_sign_in_with_account', { address, hostId, accountUuid, deviceName }),
  linkStart: (address: string, code: string, accountUuid: string, deviceName: string, verificationId: string | null = null) => invoke<LinkResult>('host_link_start', { address, code, accountUuid, deviceName, verificationId }),
  linkPoll: (linkId: string) => invoke<LinkResult>('host_link_poll', { linkId }),
  servers: (hostId: string) => invoke<{ servers: HostServer[]; nextCursor: string | null }>('host_servers', { hostId }),
  info: (hostId: string) => request<HostInfo>(hostId, 'info'),
  /** Owners only: rename the machine or change how new devices get in. */
  update: (hostId: string, body: HostUpdate) => request<{ hostId: string; name: string; newDeviceSignIn: NewDeviceSignIn; revision: string }>(hostId, 'update', { body }),
  owners: (hostId: string) => request<{ owners: HostOwner[] }>(hostId, 'owners'),
  devices: (hostId: string) => request<{ devices: HostDevice[]; nextCursor: string | null }>(hostId, 'devices'),
  linkCode: (hostId: string, targetAccountId: string) => request<{ linkId: string; code: string; expiresAt: string }>(hostId, 'link_code', { body: { targetAccountId } }),
  linkStatus: (hostId: string, id: string) => request<LinkResult>(hostId, 'link_status', { id }),
  linkApprove: (hostId: string, id: string, requestHash: string) => request<void>(hostId, 'link_approve', { id, body: { requestHash } }),
  deviceRevoke: (hostId: string, id: string) => request<void>(hostId, 'device_revoke', { id }),
  ownerChange: (hostId: string, action: 'owner_promote' | 'owner_demote' | 'ownership_transfer', accountId: string, revision: string) => request<{ authGeneration: string; revision: string }>(hostId, action, { id: accountId, revision }),
  folderRoots: (hostId: string) => request<{ roots: FolderRoot[]; revision: string }>(hostId, 'folder_roots'),
  folderResolve: (hostId: string, rootId: string, relativePath: string) => request<{ folderToken: string; displayPath: string; expiresAt: string }>(hostId, 'folder_resolve', { body: { rootId, relativePath } }),
  folderList: (hostId: string, folderToken: string, cursor: string | null = null) => request<{ displayPath: string; entries: Folder[]; nextCursor: string | null }>(hostId, 'folder_list', { body: { folderToken, cursor } }),
  /** An absolute path typed on this device, checked on the machine. */
  folderCheck: (hostId: string, path: string) => request<FolderCheck>(hostId, 'folder_check', { body: { path } }),
  importCandidates: (hostId: string) => request<{ candidates: unknown[]; warnings: unknown[] }>(hostId, 'import_candidates'),
  importInspect: (hostId: string, folderToken: string, gamePort: number | null = null) => request<unknown>(hostId, 'import_inspect', { body: { folderToken, gamePort } }),
  importResources: (hostId: string, gamePort: number | null, memoryMiB: number | null) => request<unknown>(hostId, 'import_resources', { body: { gamePort, memoryMiB } }),
  importPlan: (hostId: string, body: ImportPlan, idempotencyKey: string) => request<{ jobId: string; state: ImportState }>(hostId, 'import_plan', { body, idempotencyKey }),
  importApply: (hostId: string, body: ImportApply, idempotencyKey: string) => request<{ jobId: string; serverId: string }>(hostId, 'import_apply', { body, idempotencyKey }),
  importJob: (hostId: string, id: string) => request<ImportJob>(hostId, 'import_job', { id }),
  importCancel: (hostId: string, id: string, idempotencyKey: string) => request<{ state: ImportState }>(hostId, 'import_cancel', { id, body: {}, idempotencyKey }),
  importResume: (hostId: string, id: string, idempotencyKey: string) => request<ImportJob>(hostId, 'import_resume', { id, body: {}, idempotencyKey }),
  importStart: (hostId: string, id: string, idempotencyKey: string) => request<ImportJob>(hostId, 'import_start', { id, body: {}, idempotencyKey }),
  importReadiness: (hostId: string, id: string) => request<ImportJob>(hostId, 'import_readiness', { id }),
  catalogueMinecraft: (hostId: string) => request<MinecraftCatalogue>(hostId, 'catalogue_minecraft'),
  catalogueSoftware: (hostId: string, minecraftVersion: string) => request<SoftwareCatalogue>(hostId, 'catalogue_software', { body: { minecraftVersion } }),
  /** Suggestions for a new server: the first free name and port, memory the machine can spare. */
  createDefaults: (hostId: string) => request<CreateDefaults>(hostId, 'create_defaults'),
  createRestoreSources: (hostId: string) => request<{ sources: RestoreSource[] }>(hostId, 'create_restore_sources'),
  createPlan: (hostId: string, body: CreatePlan, idempotencyKey: string) => request<{ jobId: string; state: ImportState }>(hostId, 'create_plan', { body, idempotencyKey }),
  createApply: (hostId: string, body: CreateApply, idempotencyKey: string) => request<{ jobId: string; serverId: string }>(hostId, 'create_apply', { body, idempotencyKey }),
  createJob: (hostId: string, id: string) => request<CreateJob>(hostId, 'create_job', { id }),
  createCancel: (hostId: string, id: string, idempotencyKey: string) => request<{ state: ImportState }>(hostId, 'create_cancel', { id, body: {}, idempotencyKey }),
  createResume: (hostId: string, id: string, idempotencyKey: string) => request<CreateJob>(hostId, 'create_resume', { id, body: {}, idempotencyKey }),
  createStart: (hostId: string, id: string, idempotencyKey: string) => request<CreateJob>(hostId, 'create_start', { id, body: {}, idempotencyKey }),
  /**
   * Owners only: stop a server and remove it from the machine, recoverable there for 7 days.
   * `confirmName` is the server's current name exactly as typed; one key per attempt.
   */
  removeServer: (hostId: string, serverId: string, confirmName: string, idempotencyKey: string) =>
    request<ServerRemoved>(hostId, 'server_remove', { id: serverId, body: { confirmName }, idempotencyKey }),
  /** Owners only, `server-purge`: stop a server and delete it now, skipping the removed list. */
  purgeServer: (hostId: string, serverId: string, confirmName: string, keepBackups: boolean, idempotencyKey: string) =>
    request<ServerPurging>(hostId, 'server_remove', { id: serverId, body: { confirmName, permanently: true, keepBackups }, idempotencyKey }),
  /** Owners only, `removed-servers`: servers that can still be brought back, newest first. */
  removedServers: (hostId: string, cursor: string | null = null) =>
    request<{ servers: RemovedServer[]; nextCursor: string | null }>(hostId, 'servers_removed', cursor ? { body: { cursor } } : {}),
  /** Brings a removed server back, stopped. The machine picks a free name and port if its old ones are taken. */
  restoreServer: (hostId: string, serverId: string, idempotencyKey: string) =>
    request<ServerRestored>(hostId, 'server_restore', { id: serverId, body: {}, idempotencyKey }),
  /** Owners only, `server-purge`: delete a removed server for good now. */
  purgeRemovedServer: (hostId: string, serverId: string, confirmName: string, keepBackups: boolean, idempotencyKey: string) =>
    request<ServerPurging>(hostId, 'server_purge', { id: serverId, body: { confirmName, keepBackups }, idempotencyKey }),
  /** Owners only, `storage`: answered from the last measurement, so it is quick. */
  storage: (hostId: string) => request<HostStorage>(hostId, 'storage'),
  /** Asks for a fresh measurement; poll `storage` while `measuring` is true. */
  measureStorage: (hostId: string) => request<{ measuring: boolean }>(hostId, 'storage_measure', { body: {} }),
};
