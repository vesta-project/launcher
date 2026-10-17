import type { NativeInstance } from './native-model';
import type { InstalledResource, WorldInfo } from './details';

export interface WorldRef { instanceId: number; directoryName: string }
export interface NativeWorld {
  ref: WorldRef; displayName: string; lastPlayedAt: string | null; sizeBytes: number;
  iconDataUrl: string | null; running: boolean; gameVersion?: string | null;
}
export interface NativeResource {
  id: number; platform: string; remote_id: string; remote_version_id: string;
  resource_type: string; local_path: string; display_name: string; current_version: string;
  is_manual: boolean; is_enabled: boolean; file_size: number; source_kind: string;
}
/** Preserve the full backend version for install_resource; do not reconstruct artifacts. */
export interface NativeVersion {
  id: string; project_id: string; version_number: string; game_versions: string[];
  loaders: string[]; release_type: string;
  [field: string]: unknown;
}
export interface NativeDatapack {
  resourceId: number | null; fileName: string; displayName: string; platform: string | null;
  projectId: string | null; versionId: string | null; versionNumber: string | null;
  enabled: boolean; managed: boolean; readOnly: boolean; sizeBytes: number;
}
export function resourceFromNative(row: NativeResource, icon: string, update?: NativeVersion): InstalledResource {
  return {
    id: String(row.id), kind: row.resource_type as InstalledResource['kind'],
    filename: row.local_path.split(/[\\/]/).at(-1) || row.local_path,
    name: row.display_name, author: '', version: row.current_version, enabled: row.is_enabled,
    bundled: row.source_kind === 'modpack', update: update?.version_number,
    sizeKb: Math.ceil(row.file_size / 1024), source: resourceSource(row.platform, row.is_manual), icon,
  };
}
export function resourceSource(platform: string | null, manual = false): InstalledResource['source'] {
  return manual ? 'Local' : platform === 'modrinth' ? 'Modrinth' : platform === 'curseforge' ? 'CurseForge' : platform === 'smithed' ? 'Smithed' : 'Local';
}
export function worldFromNative(row: NativeWorld, fallbackIcon: string): WorldInfo {
  return { id: row.ref.directoryName, name: row.displayName, lastPlayed: row.lastPlayedAt ?? '',
    sizeMb: Math.round(row.sizeBytes / 1024 / 1024), image: row.iconDataUrl ?? fallbackIcon,
    mode: 'Unknown', days: undefined, running: row.running, gameVersion: row.gameVersion ?? undefined };
}
/** A world directory is opaque identity; it can itself contain the text `/world/`. */
export function resourceScope(scope: string): { instanceId: string; world?: WorldRef } {
  const at = scope.indexOf('/world/');
  if (at < 0) return { instanceId: scope };
  return { instanceId: scope.slice(0, at), world: { instanceId: Number(scope.slice(0, at)), directoryName: scope.slice(at + 7) } };
}
export interface NativeCrash {
  crash_id?: string; title?: string; message?: string; evidence?: string;
  report_path?: string; log_path?: string; suggested_fixes?: string[]; mclogs_url?: string;
}
export function parseNativeCrash(raw?: string | null): NativeCrash {
  if (!raw) return {};
  try { const value: unknown = JSON.parse(raw); if (value && typeof value === 'object' && !Array.isArray(value)) return value as NativeCrash; }
  catch { /* Old hosts persisted plain text. */ }
  return { message: raw };
}
/** Merge only overlapping suffix/prefix lines, preserving repeated messages in the stream. */
export function logCatchup(history: string[], queued: string[]): string[] {
  // Prefix-function gives the overlap in linear time, even for thousands of repeated lines.
  const joined = [...queued, undefined, ...history];
  const borders = Array.from({ length: joined.length }, () => 0);
  for (let index = 1; index < joined.length; index++) {
    let length = borders[index - 1];
    while (length > 0 && joined[index] !== joined[length]) length = borders[length - 1];
    if (joined[index] === joined[length]) length++;
    borders[index] = length;
  }
  return [...history, ...queued.slice(borders.at(-1) ?? 0)];
}

export function worldRouteId(segment?: string): string | undefined {
  try { return segment === undefined ? undefined : decodeURIComponent(segment); } catch { return undefined; }
}

type TransferInstance = Pick<NativeInstance, 'minecraftVersion' | 'modloader' | 'modpackId' | 'modpackVersionId'>;
/** Match Rust world-transfer compatibility warnings, including modded duplicates. */
export function worldTransferNeedsAcknowledgement(source: TransferInstance, destination: TransferInstance, savedVersion?: string): boolean {
  const vanilla = (instance: TransferInstance) => !instance.modpackId && (!instance.modloader?.trim() || instance.modloader.trim().toLowerCase() === 'vanilla');
  return source.minecraftVersion !== destination.minecraftVersion || source.modpackId !== destination.modpackId
    || source.modpackVersionId !== destination.modpackVersionId || !vanilla(source) || !vanilla(destination)
    || !!(savedVersion && savedVersion !== destination.minecraftVersion);
}
