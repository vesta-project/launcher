import { dialogStore } from "@stores/dialog-store";
import type { ResourceVersion } from "@stores/resources";
import type { WorldSummary } from "@stores/worlds";
import {
	classifyDatapackVersionCompatibility,
	type DatapackVersionCompatibility,
} from "@utils/resource-install-intent";
import { t } from "~/localization";

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
	if (versions.length === 0) return t("action-datapack-versions-not-specified");
	if (versions.length <= 5) return versions.join(", ");
	return t("action-datapack-versions-range", {
		firstVersion: versions[0],
		lastVersion: versions[versions.length - 1],
		count: versions.length,
	});
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
	const targetVersion = params.world.gameVersion ??
		(params.world.dataVersion != null
			? t("action-datapack-data-version", {
					dataVersion: String(params.world.dataVersion),
				})
			: t("action-datapack-unknown-saved-version"));
	return t("action-datapack-compatibility-description", {
		projectName: params.projectName,
		releaseVersion: params.version.version_number,
		providerVersions: summarizeProviderMinecraftVersions(params.version.game_versions),
		worldName: params.world.displayName,
		targetVersion,
		reason: params.compatibility === "sameRelease"
			? t("action-datapack-compatibility-nearby-warning")
			: t("action-datapack-compatibility-unlisted-warning"),
		closing: t("action-datapack-compatibility-warning"),
	});
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
		t("action-datapack-compatibility-confirm-title"),
		buildDatapackCompatibilityDescription({ ...params, compatibility }),
		{
			severity: "warning",
			okLabel: t("action-datapack-compatibility-install-anyway"),
			cancelLabel: t("action-datapack-compatibility-choose-another"),
		},
	);
	return { compatibility, acknowledged };
}
