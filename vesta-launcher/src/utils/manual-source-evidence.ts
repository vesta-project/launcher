import type { InstalledResource } from "@stores/resources";
import type { WorldDatapackSummary, WorldSummary } from "@stores/worlds";

export function installedManualSource(resource: InstalledResource) {
	const evidence = resource.manualSourceEvidence;
	if (
		!evidence ||
		!resource.hash ||
		evidence.installedSha1.toLowerCase() !== resource.hash.toLowerCase() ||
		evidence.resourceType.toLowerCase() !==
			resource.resource_type.toLowerCase() ||
		evidence.scope.kind !== "instance"
	)
		return undefined;
	return evidence.source ?? undefined;
}

export function datapackManualSource(
	entry: WorldDatapackSummary,
	world: WorldSummary,
) {
	const evidence = entry.manualSourceEvidence;
	if (
		!evidence ||
		evidence.resourceType.toLowerCase() !== "datapack" ||
		evidence.scope.kind !== "world" ||
		evidence.scope.worldId !== world.worldId
	)
		return undefined;
	return evidence.source ?? undefined;
}

export function worldManualSource(world: WorldSummary) {
	const evidence = world.archiveEvidence;
	return evidence && evidence.worldId === world.worldId
		? (evidence.source ?? undefined)
		: undefined;
}
