export type QueuedShortcutIntent =
  | { type: "argv"; args: string[] }
  | { type: "path"; path: string };
export interface InstanceShortcutIntent {
  slug: string;
  launch: boolean;
}
export interface ProjectShortcutIntent {
  platform: "modrinth" | "curseforge" | "smithed";
  projectId: string;
  installPack: boolean;
}

/** Accept the CLI and deep-link targets emitted by the existing shortcut service. */
export function parseInstanceShortcutArgs(args: string[]): (InstanceShortcutIntent | ProjectShortcutIntent)[] {
  const intents: (InstanceShortcutIntent | ProjectShortcutIntent)[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--launch-instance" || arg === "--open-instance") {
      const slug = args[index + 1];
      if (slug?.trim() && !slug.startsWith("--")) {
        intents.push({ slug, launch: arg === "--launch-instance" });
        index++;
      }
    } else if (arg.startsWith("vesta://")) {
      try {
        const url = new URL(arg);
        if (["install", "standalone", "open-resource"].includes(url.hostname)) {
          const [, pathPlatform, pathId] = url.pathname.split("/");
          const platform = (url.searchParams.get("platform") || pathPlatform)?.toLowerCase();
          const projectId = url.searchParams.get("projectId") || pathId;
          if ((platform === "modrinth" || platform === "curseforge" || platform === "smithed")
            && projectId && /^[\w-]{1,160}$/.test(projectId)) {
            intents.push({ platform, projectId, installPack: url.hostname === "install" || url.searchParams.get("type") === "modpack" });
          }
          continue;
        }
        if (!["launch-instance", "open-instance"].includes(url.hostname)) continue;
        const slug =
          url.searchParams.get("slug") || decodeURIComponent(url.pathname.split("/")[1] || "");
        if (slug.trim()) intents.push({ slug, launch: url.hostname === "launch-instance" });
      } catch {
        /* Ignore malformed external URLs. */
      }
    }
  }
  return intents;
}
