// Native host-v1 IPC. Tokens and private keys stay native; revisions/cursors are strings.
import { invoke } from '@tauri-apps/api/core';
export interface ServerRef { hostId: string; serverId: string }
export const hostConnectionId = (ref: ServerRef) => `${ref.hostId}:${ref.serverId}`;
export interface VestaHost { id: string; name: string; fingerprint: string; endpoints: string[]; deviceId: string; keyReference: string; accountId: string; authRevision: string }
export interface HostDiscovery { hostId: string; name: string | null; fingerprint: string; address: string; state: 'claimed' | 'unclaimed' | null }
export interface HostInfo { hostId: string; name: string; fingerprint: string; endpoints: unknown[]; authGeneration: string; capabilities: string[]; role: string; revision: string }
export interface HostServer { serverId: string; name: string; gamePort: number; state: string; role: string }
export interface HostDevice { deviceId: string; name: string; accountId: string; revoked: boolean; createdAt: string }
export interface LinkResult { linkId: string; state: string; requestHash: string; deviceId?: string }
/** A code the machine accepted. Pass the id to claim or link so the same exchange is reused. */
export interface CodeVerified { verificationId: string; hostId: string; name: string | null }
export interface Folder { name: string; kind: 'directory'; folderToken: string | null; readable: boolean }
export interface ImportPlan { folderToken: string; name: string; gamePort: number | null; memoryMiB: number | null; launchChoice: { kind: 'jar' | 'java_argfile'; relativePath: string } | null; minecraftVersion: string | null }
export interface ImportApply { planId: string; confirmation: string; acknowledgedWarnings: string[]; eulaAccepted: true; sourceStoppedConfirmed: true }
export type ImportState = 'planning' | 'review' | 'applying' | 'ready' | 'starting' | 'online' | 'blocked' | 'failed' | 'cancelled' | 'interrupted';
export interface ImportJob { jobId: string; state: ImportState; phase: string; error: string | null; progress: { filesDone: number; filesTotal: number; bytesDone: number; bytesTotal: number }; review: ImportReview | null; serverId: string | null }
export interface ImportReview { planId: string; confirmation: string | null; expiresAt: string; blockers: string[]; warnings: string[]; source: { displayPath: string; snapshot: string; files: number; bytes: number }; detected: unknown; runtime: unknown; destination: { serverId: string; displayPath: string; freeBytes: number }; resources: { gamePort: number; memoryMiB: number }; processes: unknown[]; ports: unknown[]; inspection: unknown }
export type HostAction = 'info' | 'devices' | 'link_code' | 'link_status' | 'link_approve' | 'device_revoke' | 'owner_promote' | 'owner_demote' | 'ownership_transfer' | 'folder_roots' | 'folder_resolve' | 'folder_list' | 'import_candidates' | 'import_inspect' | 'import_resources' | 'import_plan' | 'import_apply' | 'import_job' | 'import_cancel' | 'import_resume' | 'import_start' | 'import_readiness';
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
  linkStart: (address: string, code: string, accountUuid: string, deviceName: string, verificationId: string | null = null) => invoke<LinkResult>('host_link_start', { address, code, accountUuid, deviceName, verificationId }),
  linkPoll: (linkId: string) => invoke<LinkResult>('host_link_poll', { linkId }),
  servers: (hostId: string) => invoke<{ servers: HostServer[]; nextCursor: string | null }>('host_servers', { hostId }),
  info: (hostId: string) => request<HostInfo>(hostId, 'info'),
  devices: (hostId: string) => request<{ devices: HostDevice[]; nextCursor: string | null }>(hostId, 'devices'),
  linkCode: (hostId: string, targetAccountId: string) => request<{ linkId: string; code: string; expiresAt: string }>(hostId, 'link_code', { body: { targetAccountId } }),
  linkStatus: (hostId: string, id: string) => request<LinkResult>(hostId, 'link_status', { id }),
  linkApprove: (hostId: string, id: string, requestHash: string) => request<void>(hostId, 'link_approve', { id, body: { requestHash } }),
  deviceRevoke: (hostId: string, id: string) => request<void>(hostId, 'device_revoke', { id }),
  ownerChange: (hostId: string, action: 'owner_promote' | 'owner_demote' | 'ownership_transfer', accountId: string, revision: string) => request<{ authGeneration: string; revision: string }>(hostId, action, { id: accountId, revision }),
  folderRoots: (hostId: string) => request<{ roots: { rootId: string; label: string; displayPath: string; readable: boolean }[]; revision: string }>(hostId, 'folder_roots'),
  folderResolve: (hostId: string, rootId: string, relativePath: string) => request<{ folderToken: string; displayPath: string; expiresAt: string }>(hostId, 'folder_resolve', { body: { rootId, relativePath } }),
  folderList: (hostId: string, folderToken: string, cursor: string | null = null) => request<{ displayPath: string; entries: Folder[]; nextCursor: string | null }>(hostId, 'folder_list', { body: { folderToken, cursor } }),
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
};
