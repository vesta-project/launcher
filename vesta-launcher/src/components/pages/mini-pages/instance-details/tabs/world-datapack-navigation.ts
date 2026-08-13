import type { MiniRouter } from "@components/page-viewer/mini-router";
import { resources } from "@stores/resources";
import type { WorldDatapackSummary, WorldSummary } from "@stores/worlds";

function bindWorldDatapackBrowseContext(world: WorldSummary) {
	resources.setType("datapack");
	resources.setInstance(world.ref.instanceId);
	resources.setGameVersion(world.gameVersion);
}

/**
 * Opens datapack discovery for the owning Instance. A World is deliberately
 * chosen only when an installation starts; browsing never retains one.
 */
export function openWorldDatapackBrowser(
	world: WorldSummary,
	activeRouter: MiniRouter | undefined,
) {
	bindWorldDatapackBrowseContext(world);
	activeRouter?.navigate("/resources", {
		resourceType: "datapack",
		selectedInstanceId: String(world.ref.instanceId),
		gameVersion: world.gameVersion ?? undefined,
	});
}

export function openWorldDatapackDetails(
	world: WorldSummary,
	entry: WorldDatapackSummary,
	activeRouter: MiniRouter | undefined,
) {
	if (!entry.projectId || !entry.platform) return;
	bindWorldDatapackBrowseContext(world);
	const replacementContext =
		entry.resourceId == null
			? {}
			: {
					replacementResourceId: String(entry.resourceId),
					replacementWorldInstanceId: String(world.ref.instanceId),
					replacementWorldDirectory: world.ref.directoryName,
				};
	activeRouter?.navigate("/resource-details", {
		projectId: entry.projectId,
		platform: entry.platform,
		resourceType: "datapack",
		...replacementContext,
	});
}
