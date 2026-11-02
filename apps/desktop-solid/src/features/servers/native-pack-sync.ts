import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId, ServerCommandError } from './native';

export type PackSyncStatus = 'current' | 'update_available' | 'update_required';
export const PACK_SYNC_STATUS_EVENT = 'core://pack-sync-status';
export const PACK_SYNC_CHANGED_EVENT = 'core://pack-sync-changed';
export interface PackSyncRuntime { minecraftVersion: string; loader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'; loaderVersion: string | null }
export interface PackSyncLink { connectionId: ConnectionId; serverId: string; fingerprint: string; highestRevision: string; highestMinimum: string; highestSha256: string }
export interface PackSyncChange { path: string; operation: 'add' | 'remove' | 'update'; executable: boolean }
/** Native-owned, single-use review. All revisions remain decimal strings. */
export interface PackSyncPreview {
  reviewId: string; connectionId: ConnectionId; instanceId: number | null;
  serverId: string; fingerprint: string; revision: string; minimumRevision: string;
  artifactSha256: string; name: string; runtime: PackSyncRuntime; changes: PackSyncChange[];
  executableChanges: string[]; consentRequired: boolean;
}
export interface PackSyncApply {
  reviewId: string;
  /** Exact reviewed revision after explicit executable-change consent. Never persist a blanket grant. */
  consentRevision?: string | null;
  /** Used only for a new local instance; native chooses its directory. */
  name?: string | null;
  /** Existing instance only: verifies exact pack file hashes, then records ownership without installation. */
  linkOnly?: boolean;
}
export interface PackSyncCheck {
  instanceId: number; connectionId: ConnectionId; installedRevision: string | null;
  publishedRevision: string; minimumRevision: string; status: PackSyncStatus | null;
  availability: 'online' | 'server_offline' | 'verification_failed'; canLaunch: boolean;
  checkedAtMs: number; error: ServerCommandError | null;
}

export const serversPackSyncNative = {
  /** null creates a fresh instance; an existing ID reviews installation/update or linking. Downloads verified bytes before review. */
  packSyncPreview: (connectionId: ConnectionId, instanceId: number | null = null) => invoke<PackSyncPreview>('server_pack_sync_preview', { connectionId, instanceId }),
  /** Resolves after the durable local commit. Single use; if the result is uncertain, inspect link/check before creating again. */
  packSyncApply: (request: PackSyncApply) => invoke<number>('server_pack_sync_apply', { request }),
  packSyncLink: (instanceId: number) => invoke<PackSyncLink | null>('server_pack_sync_link', { instanceId }),
  /** Fresh signed status only; null means unlinked. Native also checks on launch and every 60 seconds. */
  packSyncCheck: (instanceId: number) => invoke<PackSyncCheck | null>('server_pack_sync_check', { instanceId }),
  packSyncDiscard: (reviewId: string) => invoke<void>('server_pack_sync_discard', { reviewId }),
};

/** Existing launch IPC returns a string; extract its structured pack gate without guessing from prose. */
export function parsePackSyncLaunchBlock(error: unknown): PackSyncCheck | ServerCommandError | null {
  if (typeof error !== 'string' || !error.startsWith('pack_sync:')) return null;
  try { const value: unknown = JSON.parse(error.slice('pack_sync:'.length)); return typeof value === 'object' && value !== null && ('canLaunch' in value || 'code' in value) ? value as PackSyncCheck | ServerCommandError : null; } catch { return null; }
}

export interface PackResourceDetails { path: string; platform: string | null; projectId: string | null }
export interface PackSyncDetails extends PackSyncPreview {
  version?: string | null; author?: string | null; description?: string | null; iconUrl?: string | null;
  format?: string; resources?: PackResourceDetails[];
}
export function customModsWithoutProvider(details: Pick<PackSyncDetails, 'format' | 'resources'>): PackResourceDetails[] {
  return details.format === 'custom' ? (details.resources ?? []).filter(item => item.path.startsWith('mods/') && item.path.toLowerCase().endsWith('.jar') && !['modrinth', 'curseforge'].includes(item.platform ?? '')) : [];
}

export function serverPackMetadata(details: PackSyncDetails): import('../installation/install-service').PackInfo {
  return {
    name: details.name, version: details.version ?? '', author: details.author ?? null,
    description: details.description ?? null, iconUrl: details.iconUrl ?? null,
    minecraftVersion: details.runtime.minecraftVersion, modloader: details.runtime.loader,
    modloaderVersion: details.runtime.loaderVersion,
    modCount: details.resources?.length ?? details.changes.filter(item => /^(mods|resourcepacks|shaderpacks)\//.test(item.path)).length,
    format: details.format ?? 'server',
  };
}

export function archiveResourceDetails(metadata: unknown): PackResourceDetails[] {
  const mods = (metadata as { mods?: { Modrinth?: { path: string; urls: string[] }; CurseForge?: { project_id?: number; file_id: number } }[] } | undefined)?.mods;
  if (!Array.isArray(mods)) return [];
  return mods.flatMap(entry => {
    if (entry.Modrinth) {
      const mod = entry.Modrinth;
      const project = mod.urls?.map(url => { try { const parsed = new URL(url); return parsed.hostname === 'cdn.modrinth.com' ? parsed.pathname.match(/^\/data\/([^/]+)\//)?.[1] : undefined; } catch { return undefined; } }).find(Boolean);
      return [{ path: mod.path, platform: project ? 'modrinth' : null, projectId: project ?? null }];
    }
    if (entry.CurseForge) return [{ path: `CurseForge file ${entry.CurseForge.file_id}`, platform: 'curseforge', projectId: entry.CurseForge.project_id?.toString() ?? null }];
    return [];
  });
}
