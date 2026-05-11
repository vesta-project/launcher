import { getMinecraftVersions, type PistonMetadata } from "@utils/instances";
import { createSignal } from "solid-js";

/**
 * Shared signal for Minecraft version metadata.
 * Fetch starts immediately on module import — by the time the
 * install page opens, data is already loaded or nearly there.
 * All components share the same signal; no duplicate requests.
 */
const [versions, setVersions] = createSignal<PistonMetadata | undefined>(
  undefined,
  {
    equals: false,
  },
);

// Eager-fetch on import — no waiting for a component to call useMinecraftVersions
getMinecraftVersions()
  .then(setVersions)
  .catch((e) => console.error("[versions store] Failed to load:", e));

export function useMinecraftVersions() {
  return versions;
}
