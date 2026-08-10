import type { MiniRouter } from "@components/page-viewer/mini-router";
import { resources } from "@stores/resources";
import type { WorldDatapackSummary, WorldSummary } from "@stores/worlds";

function bindWorldDatapackTarget(world: WorldSummary) {
	resources.setType("datapack");
	resources.setInstance(world.ref.instanceId);
	resources.setGameVersion(world.gameVersion);
	resources.setPreferredInstallTarget({ kind: "world", world: world.ref });
}

/**
 * Opens datapack discovery with an exact world target. The setter order is
 * intentional: changing the browse category clears any stale scoped target.
 */
export function openWorldDatapackBrowser(
	world: WorldSummary,
	activeRouter: MiniRouter | undefined,
) {
	bindWorldDatapackTarget(world);
	activeRouter?.navigate("/resources", {
		resourceType: "datapack",
		selectedInstanceId: String(world.ref.instanceId),
		gameVersion: world.gameVersion ?? undefined,
	});
}

export function openWorldDatapackVersions(
	world: WorldSummary,
	entry: WorldDatapackSummary,
	activeRouter: MiniRouter | undefined,
) {
	if (!entry.projectId || !entry.platform || entry.resourceId == null) return;
	bindWorldDatapackTarget(world);
	activeRouter?.navigate("/resource-details", {
		projectId: entry.projectId,
		platform: entry.platform,
		resourceType: "datapack",
		activeTab: "versions",
		replacementResourceId: String(entry.resourceId),
	});
}
