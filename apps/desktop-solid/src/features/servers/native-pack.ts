import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';
import type { ContentProvider } from './native-content';
import type { ResourceProject, ResourceVersion } from '../browse/browse-model';

/** Browse glue may enable its modpack destination with these commands. */
export const MODPACK_TARGET_READY = true;
export type PackLoader = 'none' | 'fabric' | 'quilt' | 'neoforge' | 'forge';
export type PackEntryKind = 'mod' | 'resource_pack' | 'shader' | 'datapack' | 'config_override';
export type PackSide = 'required' | 'optional' | 'unsupported';
export type PackEntrySource = ({ type: 'provider' } & ContentProvider) | { type: 'upload'; sha256: string } | { type: 'manual'; reason: string };
export interface PackEntry { id: string; kind: PackEntryKind; path: string; required: boolean; environment: { client: PackSide; server: PackSide }; source: PackEntrySource }
export interface PackManifest { name: string; summary: string; icon: string | null; displayVersion: string; minecraftVersion: string; loader: PackLoader; loaderVersion: string | null; entries: PackEntry[] }
export interface PackDraft { revision: string; manifest: PackManifest }
export interface PackIcon { mimeType: 'image/png' | 'image/jpeg'; contentBase64: string }
export interface PackWorkspace { draft: PackDraft; serverMinecraftVersion: string; minecraftDrift: boolean; publishedRevision: string; minimumRevision: string; pendingPublication: boolean; safetySnapshotRecommended: boolean }
export interface PackDraftWrite { expectedRevision: string; manifest: PackManifest }
export interface PackProviderSelection extends ContentProvider { required: boolean }
export interface PackBrowseAdd extends ContentProvider { expectedRevision: string; required: boolean; dependencies: PackProviderSelection[] }
export type PackImport = { source: 'archive'; expectedRevision: string; contentBase64: string } | { source: 'uploaded_archive'; expectedRevision: string; uploadId: string } | { source: 'published'; expectedRevision: string; expectedPublishedRevision: string };
export interface PackSuggestion { id: string; kind: 'client_mod_missing' | 'newer_compatible_version' | 'server_mod_removed' | 'minecraft_version_drift'; entryId: string | null; provider: ContentProvider | null; path: string | null }
export interface PackSuggestions { draftRevision: string; items: PackSuggestion[]; warnings: string[]; potentiallyOutdated: boolean }
export interface PackIssue { code: string; entryId: string | null; severity: 'warning' | 'error' }
export interface PackDiff { added: PackEntry[]; removed: PackEntry[]; changed: { before: PackEntry; after: PackEntry; versionChanged: boolean }[]; metadataChanged: boolean; customOverrides: string[]; symbolicLinks: string[] }
export interface PackPreview { draftRevision: string; publishedRevision: string; manifest: PackManifest; issues: PackIssue[]; diff: PackDiff; suggestions: PackSuggestion[]; reviewSha256: string; valid: boolean; safetySnapshotRecommended: boolean; resolvedEntries: PackEntry[]; warnings: string[] }
export interface PackPublish { expectedRevision: string; draftRevision: string; resolvedEntries: PackEntry[]; reviewSha256: string; requiredUpdate: boolean; acknowledgeLowerVersion: boolean }
export interface PackPublishOutcome { hostedRevision: string; minimumRevision: string }
export interface PackDependency { project: ResourceProject; version: ResourceVersion; required: boolean; installed: boolean; entry: PackEntry }
export interface PackDependencyPreview { target: PackWorkspace; project: ResourceProject; version: ResourceVersion; entry: PackEntry; dependencies: PackDependency[]; warnings: string[] }
export interface PackUploadBegin { uploadId: string; totalSize: string; sha256: string; archive: boolean }
export interface PackUploadChunk { uploadId: string; offset: string; contentBase64: string }
export interface PackUploadReceipt { uploadId: string; size: string; sha256: string; complete: boolean }
const call = <T>(command: string, args: Record<string, unknown>) => invoke<T>(command, args);
export const serversPackNative = {
  packDraft: (connectionId: ConnectionId) => call<PackWorkspace>('server_pack_draft', { connectionId }),
  packIcon: (connectionId: ConnectionId) => call<PackIcon | null>('server_pack_icon', { connectionId }),
  packWrite: (connectionId: ConnectionId, request: PackDraftWrite, intentId: string) => call<PackDraft>('server_pack_write', { connectionId, request, intentId }),
  packDelete: (connectionId: ConnectionId, expectedRevision: string, intentId: string) => call<PackDraft>('server_pack_delete', { connectionId, request: { expectedRevision }, intentId }),
  packImport: (connectionId: ConnectionId, request: PackImport, intentId: string) => call<PackDraft>('server_pack_import', { connectionId, request, intentId }),
  packSuggestions: (connectionId: ConnectionId) => call<PackSuggestions>('server_pack_suggestions', { connectionId }),
  packDependencies: (connectionId: ConnectionId, provider: ContentProvider['provider'], projectId: string, versionId: string) => call<PackDependencyPreview>('server_pack_dependencies', { connectionId, provider, projectId, versionId }),
  /** One atomic draft edit of pinned root + explicitly chosen dependencies. */
  packAdd: (connectionId: ConnectionId, request: PackBrowseAdd, intentId: string) => call<PackDraft>('server_pack_add', { connectionId, request, intentId }),
  /** Shared instance resolver auto-includes required dependencies in this preview only. */
  packPreview: (connectionId: ConnectionId, draftRevision: string) => call<PackPreview>('server_pack_preview', { connectionId, draftRevision }),
  packBuildPublish: (connectionId: ConnectionId, request: PackPublish, intentId: string) => call<PackPublishOutcome>('server_pack_build_publish', { connectionId, request, intentId }),
  packUploadBegin: (connectionId: ConnectionId, request: PackUploadBegin, intentId: string) => call<PackUploadReceipt>('server_pack_upload_begin', { connectionId, request, intentId }),
  packUploadChunk: (connectionId: ConnectionId, request: PackUploadChunk, intentId: string) => call<PackUploadReceipt>('server_pack_upload_chunk', { connectionId, request, intentId }),
  packUploadFinish: (connectionId: ConnectionId, uploadId: string, intentId: string) => call<PackUploadReceipt>('server_pack_upload_finish', { connectionId, request: { uploadId }, intentId }),
  packUploadCancel: (connectionId: ConnectionId, uploadId: string, intentId: string) => call<boolean>('server_pack_upload_cancel', { connectionId, request: { uploadId }, intentId }),
};

type UploadApi = Pick<typeof serversPackNative, 'packUploadBegin' | 'packUploadChunk' | 'packUploadFinish'>;
/** Stable resumable intents; 32 KiB chunks fit the agent's default 64 KiB request budget. */
export async function uploadPackBytes(api: UploadApi, connectionId: string, bytes: Uint8Array, archive: boolean, intentId: string): Promise<PackUploadReceipt> {
  const sha256 = async (value: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
  const uploadId = await sha256(new TextEncoder().encode(intentId));
  await api.packUploadBegin(connectionId, { uploadId, totalSize: String(bytes.length), sha256: await sha256(bytes), archive }, `${uploadId}-begin`);
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    const contentBase64 = btoa(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    await api.packUploadChunk(connectionId, { uploadId, offset: String(offset), contentBase64 }, `${uploadId}-${offset}`);
  }
  return api.packUploadFinish(connectionId, uploadId, `${uploadId}-finish`);
}
