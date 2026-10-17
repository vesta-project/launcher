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
    modCount: 0,
    format: project.source === 'curseforge' ? 'CurseForge' : 'Modrinth',
    modpackId: project.id,
    modpackVersionId: release.id,
    modpackPlatform: project.source,
  };
}
