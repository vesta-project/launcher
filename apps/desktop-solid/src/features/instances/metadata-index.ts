export interface GameVersion {
  id: string;
  stable: boolean;
  version_type: string;
  loaders: Record<string, { version: string; stable: boolean }[]>;
}
export interface Metadata {
  game_versions: GameVersion[];
  latest: { release: string; snapshot: string };
}

const emptyVersions: string[] = [];
const emptyGames: GameVersion[] = [];

/** One immutable index per metadata response. Preserve the host's release ordering. */
export function indexMetadata(metadata: Metadata) {
  const loaders = new Map<string, Map<string, string[]>>();
  const games = new Map<string, { all: GameVersion[]; stable: GameVersion[] }>();
  games.set('vanilla', { all: metadata.game_versions, stable: metadata.game_versions.filter(version => version.stable) });
  for (const game of metadata.game_versions) {
    const byLoader = new Map<string, string[]>();
    loaders.set(game.id, byLoader);
    for (const [loader, versions] of Object.entries(game.loaders)) {
      if (loader === 'vanilla' || !versions.length) continue;
      byLoader.set(loader, versions.map(version => version.version));
      let compatible = games.get(loader);
      if (!compatible) { compatible = { all: [], stable: [] }; games.set(loader, compatible); }
      compatible.all.push(game);
      if (game.stable) compatible.stable.push(game);
    }
  }
  return {
    metadata,
    ids: metadata.game_versions.map(game => game.id),
    loaderVersions: (minecraft: string, loader: string) => loaders.get(minecraft)?.get(loader) ?? emptyVersions,
    gameVersions: (loader: string, experimental: boolean) => {
      const compatible = games.get(loader);
      return (experimental ? compatible?.all : compatible?.stable) ?? emptyGames;
    },
  };
}
