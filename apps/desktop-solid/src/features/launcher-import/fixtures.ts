import type { HostCandidate } from './model';

export const fixtureLaunchers = [
  { kind: 'prism', detectedPaths: ['/preview/PrismLauncher'] },
  { kind: 'modrinthApp', detectedPaths: ['/preview/ModrinthApp'] },
];
export const fixtureCandidates = (launcher: string): HostCandidate[] => {
  const root = fixtureLaunchers.find((row) => row.kind === launcher)?.detectedPaths[0];
  if (!root) return [];
  return (launcher === 'prism'
    ? ['Survival', 'Create Together', 'Sky Factory', 'Vanilla Adventures']
    : ['Simply Optimized', 'Cobblemon', 'Prominence II', 'Fabulously Optimized']
  ).map((name, index) => ({ id: String(index), name, instancePath: `${root}/${index}`,
    gameDirectory: `${root}/${index}/minecraft`, minecraftVersion: '1.21.1',
    modloader: index === 3 ? null : 'fabric', modsCount: index === 3 ? 0 : 32 + index * 17,
    lastPlayedAtUnixMs: Date.UTC(2026, 9, 20 - index) }));
};
