export interface LauncherSummary {
  id: string;
  label: string;
  icon?: string;
  path?: string;
  instanceCount?: number;
}

export interface ImportCandidate {
  key: string;
  launcher: string;
  name: string;
  minecraft?: string;
  loader?: string;
  iconUrl?: string;
  lastPlayed?: string;
  modCount?: number;
  alreadyImported: boolean;
  raw: unknown;
}

/** Host payload retained intact for import and the existing detailed preview. */
export interface HostCandidate {
  id: string;
  name: string;
  instancePath: string;
  gameDirectory: string;
  iconPath?: string | null;
  minecraftVersion?: string | null;
  modloader?: string | null;
  modloaderVersion?: string | null;
  modpackPlatform?: string | null;
  modpackId?: string | null;
  modpackVersionId?: string | null;
  lastPlayedAtUnixMs?: number | null;
  modsCount?: number | null;
  resourcepacksCount?: number | null;
  shaderpacksCount?: number | null;
  worldsCount?: number | null;
  screenshotsCount?: number | null;
  gameDirectorySizeBytes?: number | null;
}

export interface ImportResult {
  queued: number;
  failed: { key: string; error: string }[];
}
