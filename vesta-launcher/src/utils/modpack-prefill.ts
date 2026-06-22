import type { ResourceProject, ResourceVersion } from "@stores/resources";
import type { ModpackInfo } from "./modpacks";

export function countVersionResources(version?: ResourceVersion | null): number {
	return (
		version?.dependencies?.filter((dep) => dep.dependency_type !== "incompatible").length || 0
	);
}

export function deriveVersionScopedResourceState(
	version?: ResourceVersion | null,
	options?: { fallbackPending?: boolean },
): Pick<
	ModpackInfo,
	"modCount" | "modCountSource" | "isCountingResources" | "modCountLookupFailed"
> {
	const modCount = countVersionResources(version);
	if (modCount > 0) {
		return {
			modCount,
			modCountSource: "api-dependencies",
			isCountingResources: false,
			modCountLookupFailed: false,
		};
	}

	return {
		modCount: 0,
		modCountSource: "unknown",
		isCountingResources: !!options?.fallbackPending,
		modCountLookupFailed: false,
	};
}

export function shouldFetchArchiveSummary(
	info?: Pick<ModpackInfo, "modCountSource" | "modCountLookupFailed"> | null,
): boolean {
	return !!info && info.modCountSource === "unknown" && !info.modCountLookupFailed;
}

export function buildBrowseModpackInfo(
	project: ResourceProject,
	version?: ResourceVersion | null,
	options?: {
		minecraftVersion?: string | null;
		loader?: string | null;
	},
): ModpackInfo {
	const minecraftVersion =
		version?.game_versions?.[0] || options?.minecraftVersion || "";
	const loader = version?.loaders?.[0] || options?.loader || "vanilla";
	const { modCount, modCountSource, isCountingResources } =
		deriveVersionScopedResourceState(version);

	return {
		name: project.name,
		version: version?.version_number || "1.0.0",
		author: project.author || project.authors?.[0] || null,
		description: project.summary || project.description || null,
		iconUrl: project.icon_url || null,
		minecraftVersion,
		modloader: loader as ModpackInfo["modloader"],
		modloaderVersion: null,
		modCount,
		modCountSource,
		isCountingResources,
		downloadCount: project.download_count,
		followerCount: project.source === "modrinth" ? project.follower_count : null,
		recommendedRamMb: undefined,
		format: project.source,
		modpackId: project.id,
		modpackVersionId: version?.id,
		modpackPlatform: project.source,
	};
}
