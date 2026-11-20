import type { PackInfo, PackRelease } from './install-service';

/** Public provider metadata carried through Create, including release changes. */
export interface OnlinePackSelection {
  project: {
    id: string;
    source: string;
    name: string;
    summary: string;
    author: string;
    icon_url: string | null;
    download_count: number;
  };
  release: PackRelease;
}

/**
 * How many mods a provider release carries, from the content it lists (Modrinth's embedded
 * dependencies, the list Browse shows as the pack's contents). Files named as something other
 * than a jar are resource packs or shaders and don't count. 0 when the release lists nothing.
 */
export function listedModCount(release: PackRelease): number {
  return (release.dependencies ?? []).filter((item) =>
    item.dependency_type === 'embedded' && (!item.file_name || item.file_name.toLowerCase().endsWith('.jar'))).length;
}

export function onlinePackInfo({ project, release }: OnlinePackSelection): PackInfo {
  return {
    name: project.name,
    description: project.summary,
    author: project.author,
    iconUrl: project.icon_url,
    downloadCount: project.download_count,
    version: release.version_number,
    minecraftVersion: release.game_versions[0] ?? '',
    // Provider format tags (notably Modrinth's `mrpack`) are not modloaders.
    modloader: release.loaders.find((loader) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) ?? 'vanilla',
    modloaderVersion: null,
    // Sizes the memory suggestion; without it every big pack got the plain default.
    modCount: listedModCount(release),
    format: project.source === 'curseforge' ? 'CurseForge' : 'Modrinth',
    modpackId: project.id,
    modpackVersionId: release.id,
    modpackPlatform: project.source,
  };
}

export async function resolveOnlinePack(selection: OnlinePackSelection, inspect: () => Promise<PackInfo>): Promise<PackInfo> {
  const info = onlinePackInfo(selection);
  if (selection.project.source !== 'curseforge' || (info.minecraftVersion &&
      selection.release.loaders.some(loader => ['forge', 'fabric', 'quilt', 'neoforge'].includes(loader)))) return info;
  const manifest = await inspect();
  if (!manifest.minecraftVersion || !manifest.modloader || manifest.modloader === 'unknown')
    throw new Error('Pack manifest does not specify a Minecraft version and loader');
  return { ...info, minecraftVersion: manifest.minecraftVersion, modloader: manifest.modloader,
    modloaderVersion: manifest.modloaderVersion, modCount: manifest.modCount || info.modCount,
    recommendedRamMb: manifest.recommendedRamMb, versionFromManifest: true };
}
