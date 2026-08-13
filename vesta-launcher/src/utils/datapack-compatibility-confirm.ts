import { dialogStore } from "@stores/dialog-store";
import type { ResourceVersion } from "@stores/resources";
import type { WorldSummary } from "@stores/worlds";
import {
	classifyDatapackVersionCompatibility,
	type DatapackVersionCompatibility,
} from "@utils/resource-install-intent";

const NON_MINECRAFT_VERSION_LABELS = new Set(["client", "server"]);

export function summarizeProviderMinecraftVersions(
	gameVersions: readonly string[],
): string {
	const versions = Array.from(
		new Set(
			gameVersions
				.map((version) => version.trim())
				.filter(
					(version) =>
						version.length > 0 &&
						!NON_MINECRAFT_VERSION_LABELS.has(version.toLowerCase()),
				),
		),
	).sort((left, right) =>
		left.localeCompare(right, undefined, {
			numeric: true,
			sensitivity: "base",
		}),
	);
	if (versions.length === 0) return "Not specified by provider";
	if (versions.length <= 5) return versions.join(", ");
	return `${versions[0]}–${versions[versions.length - 1]} (${versions.length} versions listed)`;
}

export function buildDatapackCompatibilityDescription(params: {
	projectName: string;
	version: Pick<ResourceVersion, "version_number" | "game_versions">;
	world: Pick<
		WorldSummary,
		"displayName" | "gameVersion" | "dataVersion"
	>;
	compatibility: Exclude<DatapackVersionCompatibility, "exact">;
}): string {
	const targetVersion =
		params.world.gameVersion ??
		(params.world.dataVersion != null
			? `DataVersion ${params.world.dataVersion}`
			: "Unknown saved version");
	const reason =
		params.compatibility === "sameRelease"
			? "This release does not explicitly list the target version, although it lists a nearby Minecraft release."
			: "This release does not explicitly list the target version.";
	return [
		`Project: ${params.projectName}`,
		`Datapack release: ${params.version.version_number}`,
		`Provider-listed Minecraft versions: ${summarizeProviderMinecraftVersions(params.version.game_versions)}`,
		`Target world: ${params.world.displayName}`,
		`Target saved version: ${targetVersion}`,
		"",
		reason,
		"Datapacks often work across nearby releases, but Vesta cannot verify this one.",
	].join("\n");
}

export async function confirmDatapackWorldCompatibility(params: {
	projectName: string;
	version: Pick<ResourceVersion, "version_number" | "game_versions">;
	world: Pick<
		WorldSummary,
		"displayName" | "gameVersion" | "dataVersion"
	>;
}): Promise<{
	compatibility: DatapackVersionCompatibility;
	acknowledged: boolean;
}> {
	const compatibility = classifyDatapackVersionCompatibility(
		params.version.game_versions,
		params.world.gameVersion,
	);
	if (compatibility === "exact") {
		return { compatibility, acknowledged: true };
	}
	const acknowledged = await dialogStore.confirm(
		"Confirm datapack compatibility",
		buildDatapackCompatibilityDescription({ ...params, compatibility }),
		{
			severity: "warning",
			okLabel: "Install anyway",
			cancelLabel: "Choose another version",
		},
	);
	return { compatibility, acknowledged };
}
