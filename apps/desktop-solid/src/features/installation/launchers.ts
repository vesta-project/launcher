export const launchers = [
  { value: "curseforgeFlame", label: "CurseForge", icon: "sources/curseforge" },
  { value: "gdlauncher", label: "GDLauncher", icon: "launchers/gd-launcher" },
  { value: "prism", label: "Prism Launcher", icon: "launchers/prism-launcher" },
  { value: "multimc", label: "MultiMC", icon: "launchers/multimc" },
  { value: "modrinthApp", label: "Modrinth App", icon: "sources/modrinth" },
  { value: "atlauncher", label: "ATLauncher", icon: "launchers/at-launcher" },
  { value: "ftb", label: "FTB", icon: "launchers/feed-the-beast" },
  { value: "technic", label: "Technic Launcher", icon: "launchers/technic-launcher" },
] as const;
export type LauncherKind = (typeof launchers)[number]["value"];
export const findLauncher = (kind: string | undefined) =>
  launchers.find((item) => item.value === kind);

/** Unknown/invalid last-played dates sort after recorded sessions; names break ties. */
export function byRecency<T extends { name: string; lastPlayedAtUnixMs?: number | null }>(
  items: readonly T[],
): T[] {
  const time = (item: T) =>
    typeof item.lastPlayedAtUnixMs === "number" &&
    Number.isFinite(item.lastPlayedAtUnixMs) &&
    item.lastPlayedAtUnixMs > 0
      ? item.lastPlayedAtUnixMs
      : 0;
  return [...items].sort((a, b) => time(b) - time(a) || a.name.localeCompare(b.name));
}
