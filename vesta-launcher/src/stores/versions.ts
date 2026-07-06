import { showToast } from "@ui/toast/toast";
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

const [versionsLoading, setVersionsLoading] = createSignal(false);
const [versionsError, setVersionsError] = createSignal<string | null>(null);

/**
 * Fetch Minecraft version metadata from the backend.
 * Exported so components can retry on failure.
 */
export async function refetchMinecraftVersions() {
	setVersionsLoading(true);
	setVersionsError(null);
	try {
		const data = await getMinecraftVersions();
		setVersions(data);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error("[versions store] Failed to load:", e);
		setVersionsError(msg);
		showToast({
			title: "Failed to load Minecraft versions",
			description: msg,
			severity: "error",
		});
	} finally {
		setVersionsLoading(false);
	}
}

// Eager-fetch on import — no waiting for a component to call useMinecraftVersions
refetchMinecraftVersions();

export function useMinecraftVersions() {
	return {
		versions,
		loading: versionsLoading,
		error: versionsError,
		refetch: refetchMinecraftVersions,
	};
}
