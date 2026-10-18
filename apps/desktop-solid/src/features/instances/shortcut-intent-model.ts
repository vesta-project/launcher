export type QueuedShortcutIntent =
  | { type: "argv"; args: string[] }
  | { type: "path"; path: string };
export interface InstanceShortcutIntent {
  slug: string;
  launch: boolean;
}

/** Accept the CLI and deep-link targets emitted by the existing shortcut service. */
export function parseInstanceShortcutArgs(args: string[]): InstanceShortcutIntent[] {
  const intents: InstanceShortcutIntent[] = [];
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
