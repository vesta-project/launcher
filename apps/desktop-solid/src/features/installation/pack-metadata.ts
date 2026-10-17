import type { PackInfo } from "./install-service";

/** Optional enrichment; archive contents and engine configuration remain authoritative. */
export interface PackSourceMatch {
  matched: boolean;
  name?: string | null;
  version?: string | null;
  author?: string | null;
  description?: string | null;
  iconUrl?: string | null;
  modpackId?: string | null;
  modpackVersionId?: string | null;
  modpackPlatform?: string | null;
  downloadCount?: number | null;
}
export const packArtwork = (value?: string | null) =>
  value && /^(https?:\/\/|data:image\/)/i.test(value) ? value : undefined;
export const knownPackVersion = (value?: string | null) =>
  value && value.trim() && value.trim().toLowerCase() !== "unknown" ? value : undefined;
export function enrichLocalPack(info: PackInfo, match: PackSourceMatch): PackInfo {
  if (!match.matched || !match.modpackId || !match.modpackPlatform) return info;
  return {
    ...info,
    name: match.name || info.name,
    version: knownPackVersion(match.version) || info.version,
    author: match.author || info.author,
    description: match.description || info.description,
    iconUrl: packArtwork(match.iconUrl) || info.iconUrl,
    modpackId: match.modpackId,
    modpackVersionId: match.modpackVersionId || info.modpackVersionId,
    modpackPlatform: match.modpackPlatform,
    downloadCount: match.downloadCount ?? info.downloadCount,
  };
}
