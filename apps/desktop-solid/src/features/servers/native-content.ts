import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';
import type { SoftwareJob } from './hosting-native';
import type { ResourceProject, ResourceVersion } from '../browse/browse-model';

export type ServerContentKind = 'mod' | 'plugin' | 'datapack' | 'resource_pack' | 'shader';
export type ContentPending = 'install' | 'remove' | 'update' | 'enable' | 'disable';
export interface ContentProvider { provider: 'modrinth' | 'curseforge'; projectId: string; versionId: string }
export interface ContentDeclared { loader: string | null; side: string | null; name: string | null; version: string | null; dependencies: string[] }
export interface ServerContentEntry {
  modpackOwned?: boolean;
  kind: ServerContentKind; path: string; filename: string; size: string; enabled: boolean | null;
  sha256: string | null; provider: ContentProvider | null; declared: ContentDeclared | null;
  pending: ContentPending | null; pendingId: string | null; pendingError: string | null;
}
export interface ContentCapabilities {
  list: boolean; install: boolean; update: boolean; remove: boolean; toggle: boolean; cancel: boolean;
  modsSupported: boolean; pluginsSupported: boolean;
  datapackToggleOffline?: boolean; datapackToggleRunning?: boolean;
}
export interface ServerContentInventory {
  /** Actual writes deferred until stopped-process ownership. */
  deferredWrites?: number;
  needsRestart?: boolean;
  items: ServerContentEntry[]; capabilities: ContentCapabilities; minecraftVersion: string;
  /** Authoritative managed server family, independent of the client pack loader. Null for unidentified/custom software. */
  software: string | null; truncated: boolean;
}
export interface ContentChange { id: string; state: 'pending' | 'applied' | 'cancelled'; pending: ContentPending | null; path: string; error: string | null; trashPath?: string | null }
export interface ContentInstallRequest extends ContentProvider {
  kind: ServerContentKind;
  /** Both fields required for an update; omit both for installation. An update keeps the existing filename. */
  path?: string; expectedSha256?: string;
}
export interface ContentMutation { action: 'remove' | 'enable' | 'disable'; kind: ServerContentKind; path: string; expectedSha256: string }
export interface CustomJarPlan {
  planId: string; expiresAtMs: number; expectedRevision: string; customJar: { path: string } | null;
  mainClass: string | null; risks: string[];
}
export interface ServerDependency { project: ResourceProject; version: ResourceVersion; required: boolean; installed: boolean }
export interface ServerDependencyPreview {
  target: ServerContentInventory; project: ResourceProject; version: ResourceVersion;
  dependencies: ServerDependency[]; warnings: string[];
}
const call = <T>(command: string, args: Record<string, unknown>) => invoke<T>(command, args);
export const serversContentNative = {
  content: (connectionId: ConnectionId) => call<ServerContentInventory>('server_content', { connectionId }),
  contentInstall: (connectionId: ConnectionId, request: ContentInstallRequest, intentId: string) => call<ContentChange>('server_content_install', { connectionId, request, intentId }),
  contentMutate: (connectionId: ConnectionId, request: ContentMutation, intentId: string) => call<ContentChange>('server_content_mutate', { connectionId, request, intentId }),
  contentCancel: (connectionId: ConnectionId, id: string, intentId: string) => call<ContentChange>('server_content_cancel', { connectionId, id, intentId }),
  /** Explicit, bounded optional identification; listing does no provider IO. */
  contentIdentify: (connectionId: ConnectionId, path: string, intentId: string) => call<ContentProvider | null>('server_content_identify', { connectionId, path, intentId }),
  /** Shared instance resolver against the authoritative server version/family/inventory; no installation. */
  contentDependencies: (connectionId: ConnectionId, provider: ContentProvider['provider'], projectId: string, versionId: string) => call<ServerDependencyPreview>('server_content_dependencies', { connectionId, provider, projectId, versionId }),
  /** Null path prepares restoration to the managed launch saved before custom selection. Token remains native. */
  customJarPlan: (connectionId: ConnectionId, path: string | null, expectedRevision: string) => call<CustomJarPlan>('server_custom_jar_plan', { connectionId, path, expectedRevision }),
  customJarApply: (connectionId: ConnectionId, planId: string, intentId: string) => call<SoftwareJob>('server_custom_jar_apply', { connectionId, planId, intentId }),
};
