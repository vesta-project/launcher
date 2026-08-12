import type { Instance } from "@stores/instances";
import type {
	InstalledResource,
	ResourceProject,
	ResourceType,
	ResourceVersion,
	SourcePlatform,
} from "@stores/resources";
import type { WorldRef } from "@stores/worlds";

export interface ResourceInstallRequest {
	project: ResourceProject;
	versions: ResourceVersion[];
	version?: ResourceVersion;
	/** The destination semantics chosen by the user, independent of provider classification. */
	installType: ResourceType;
	preferredInstanceId?: number;
}

export interface PendingResourceInstall {
	project: ResourceProject;
	version?: ResourceVersion;
	installType?: ResourceType;
}

export interface ManagedDatapackReplacement {
	resourceId: number;
	world: WorldRef;
}

export function replacementResourceIdForWorld(
	replacement: ManagedDatapackReplacement | null | undefined,
	target: WorldRef,
): number | undefined {
	return replacement?.world.instanceId === target.instanceId &&
		replacement.world.directoryName === target.directoryName
		? replacement.resourceId
		: undefined;
}

const normalizeArtifactRole = (role: string) =>
	role.toLowerCase().replaceAll("-", "").replaceAll("_", "");

/**
 * Returns true when installing this version needs a concrete Java world.
 * `primary` inherits the project's advertised type; companion artifacts keep
 * their own role so provider-neutral bundles can target both scopes.
 */
export function requiresWorldTarget(
	project: Pick<ResourceProject, "resource_type">,
	version?: Pick<ResourceVersion, "files"> | null,
	installType: ResourceType = project.resource_type,
): boolean {
	if (installType === "datapack") return true;
	return (version?.files ?? []).some((file) => {
		const role = normalizeArtifactRole(file.role);
		return (
			role === "datapack" || (role === "primary" && installType === "datapack")
		);
	});
}

export function hasDownloadableArtifact(
	version: Pick<ResourceVersion, "download_url" | "files">,
): boolean {
	if (version.download_url.trim()) return true;
	return (version.files ?? []).some((file) => file.url.trim().length > 0);
}

const normalizeMinecraftVersion = (version: string) =>
	version.trim().endsWith(".0") ? version.trim().slice(0, -2) : version.trim();

export type DatapackVersionCompatibility =
	| "exact"
	| "sameRelease"
	| "unlisted"
	| "unknown";

/**
 * Provider compatibility tags are advisory for datapacks. Only an explicit,
 * normalized exact tag is safe for quick selection; every other result needs
 * a user-selected version and acknowledgement.
 */
export function classifyDatapackVersionCompatibility(
	supported: readonly string[],
	target: string | null | undefined,
): DatapackVersionCompatibility {
	if (!target?.trim()) return "unknown";
	const normalizedTarget = normalizeMinecraftVersion(target);
	const normalizedSupported = supported.map(normalizeMinecraftVersion);
	if (normalizedSupported.includes(normalizedTarget)) return "exact";

	const releaseLine = (value: string) => {
		const segments = value.split(".");
		return segments.length >= 2 ? segments.slice(0, 2).join(".") : value;
	};
	return normalizedSupported.some(
		(version) => releaseLine(version) === releaseLine(normalizedTarget),
	)
		? "sameRelease"
		: "unlisted";
}

export function findBestExactDatapackVersion(
	versions: readonly ResourceVersion[],
	gameVersion: string | null | undefined,
	source?: SourcePlatform,
	currentReleaseType: "release" | "beta" | "alpha" = "release",
): ResourceVersion | null {
	if (!gameVersion) return null;
	const allowedReleaseTypes =
		currentReleaseType === "release"
			? ["release"]
			: currentReleaseType === "beta"
				? ["release", "beta"]
				: ["release", "beta", "alpha"];
	const stabilityOrder = { release: 0, beta: 1, alpha: 2 };
	return (
		versions
			.filter(
				(version) =>
					versionMatchesResourceType("datapack", version, source) &&
					classifyDatapackVersionCompatibility(
						version.game_versions,
						gameVersion,
					) === "exact" &&
					allowedReleaseTypes.includes(version.release_type),
			)
			.sort(
				(left, right) =>
					stabilityOrder[left.release_type] -
					stabilityOrder[right.release_type],
			)[0] ?? null
	);
}

export function isGameVersionCompatible(
	supported: readonly string[],
	target: string,
): boolean {
	const normalizedTarget = normalizeMinecraftVersion(target);
	const targetMajorMinor = normalizedTarget.split(".").slice(0, 2).join(".");

	return supported.some((version) => {
		const normalizedVersion = normalizeMinecraftVersion(version);
		return (
			normalizedVersion === normalizedTarget ||
			normalizedVersion === `${targetMajorMinor}.x`
		);
	});
}

/**
 * Providers describe release variants differently. Modrinth exposes datapack
 * as a loader and may mix distribution variants in one project. CurseForge and
 * Smithed classify datapacks as their own projects/feeds, so the project's
 * Resource type is authoritative there. Downloaded datapacks receive content
 * validation later.
 */
export function versionMatchesResourceType(
	resourceType: ResourceType | undefined,
	version: Pick<ResourceVersion, "loaders">,
	source?: SourcePlatform,
): boolean {
	if (resourceType !== "datapack") return true;
	const loaders = version.loaders.map((loader) => loader.toLowerCase());
	if (source === "modrinth") return loaders.includes("datapack");
	if (source === "curseforge" || source === "smithed") return true;
	return loaders.length === 0 || loaders.includes("datapack");
}

export type InstalledResourceMatch = Pick<
	InstalledResource,
	| "remote_id"
	| "remote_version_id"
	| "resource_type"
	| "display_name"
	| "platform"
	| "current_version"
	| "hash"
>;

export function findInstalledResource<T extends InstalledResourceMatch>(
	project: ResourceProject,
	installed: readonly T[],
	versions: readonly ResourceVersion[] = [],
): T | undefined {
	const projectIds = new Set(
		[project.id, ...Object.values(project.external_ids || {})].map((id) =>
			id.toLowerCase(),
		),
	);
	const projectName = project.name.toLowerCase();

	return installed.find((resource) => {
		if (projectIds.has(resource.remote_id.toLowerCase())) return true;
		if (
			resource.hash &&
			project.source.toLowerCase() !== resource.platform.toLowerCase() &&
			versions.some(
				(version) =>
					version.project_id === project.id && version.hash === resource.hash,
			)
		) {
			return true;
		}
		return (
			resource.resource_type.toLowerCase() === project.resource_type &&
			resource.display_name.toLowerCase() === projectName
		);
	});
}

export function isResourceUpdateAvailable(
	project: ResourceProject,
	installed: InstalledResourceMatch | undefined,
	version: ResourceVersion | null | undefined,
): boolean {
	if (!installed || !version) return false;
	if (installed.hash && version.hash && installed.hash === version.hash) {
		return false;
	}
	if (installed.platform.toLowerCase() === project.source.toLowerCase()) {
		return installed.remote_version_id !== version.id;
	}
	return installed.current_version !== version.version_number;
}

export function findBestVersion(
	versions: readonly ResourceVersion[],
	gameVersion: string,
	modloader: string | null,
	currentReleaseType?: "release" | "beta" | "alpha",
	resourceType?: ResourceType,
	source?: SourcePlatform,
): ResourceVersion | null {
	const instanceLoader = modloader?.toLowerCase() || "";
	const allowedReleaseTypes =
		currentReleaseType === "release" || !currentReleaseType
			? ["release"]
			: currentReleaseType === "beta"
				? ["release", "beta"]
				: ["release", "beta", "alpha"];

	const compatible = versions.filter((version) => {
		if (!versionMatchesResourceType(resourceType, version, source))
			return false;
		if (!isGameVersionCompatible(version.game_versions, gameVersion))
			return false;

		const loaders = version.loaders.map((loader) => loader.toLowerCase());
		let matchesLoader = false;
		if (resourceType === "shader" || resourceType === "resourcepack") {
			matchesLoader =
				resourceType !== "shader" ||
				(instanceLoader !== "" && instanceLoader !== "vanilla");
		} else if (resourceType === "datapack") {
			matchesLoader = true;
		} else if (instanceLoader === "" || instanceLoader === "vanilla") {
			if (resourceType === "mod") matchesLoader = false;
			else if (resourceType === "modpack") matchesLoader = true;
			else {
				matchesLoader = loaders.length === 0 || loaders.includes("minecraft");
			}
		} else {
			matchesLoader = loaders.includes(instanceLoader);
			if (!matchesLoader && instanceLoader === "quilt") {
				matchesLoader = loaders.includes("fabric");
			}
			if (!matchesLoader && instanceLoader === "neoforge") {
				matchesLoader = loaders.includes("forge");
			}
		}

		return matchesLoader && allowedReleaseTypes.includes(version.release_type);
	});

	const stabilityOrder = { release: 0, beta: 1, alpha: 2 };
	return (
		[...compatible].sort((left, right) => {
			const leftExact = left.game_versions.includes(gameVersion);
			const rightExact = right.game_versions.includes(gameVersion);
			if (leftExact !== rightExact) return leftExact ? -1 : 1;
			return (
				stabilityOrder[left.release_type] - stabilityOrder[right.release_type]
			);
		})[0] || null
	);
}

export function findBestVersionForInstance(
	project: ResourceProject,
	versions: readonly ResourceVersion[],
	instance: Pick<Instance, "minecraftVersion" | "modloader">,
	releaseType: "release" | "beta" | "alpha" = "release",
	installType: ResourceType = project.resource_type,
): ResourceVersion | null {
	return findBestVersion(
		versions,
		instance.minecraftVersion,
		instance.modloader,
		releaseType,
		installType,
		project.source,
	);
}

export type InstanceInstallDecision =
	| { kind: "world"; version?: ResourceVersion }
	| { kind: "instance"; version: ResourceVersion }
	| { kind: "unavailable" };

/**
 * Resolves destination scope only after the actual install variant is known.
 * A contextual datapack browse remains world-scoped even when the provider
 * classifies the containing project as a mod.
 */
export function resolveInstanceInstallDecision(
	project: ResourceProject,
	versions: readonly ResourceVersion[],
	instance: Pick<Instance, "minecraftVersion" | "modloader">,
	installType: ResourceType,
	requestedVersion?: ResourceVersion,
): InstanceInstallDecision {
	if (requestedVersion) {
		return requiresWorldTarget(project, requestedVersion, installType)
			? { kind: "world", version: requestedVersion }
			: { kind: "instance", version: requestedVersion };
	}
	if (installType === "datapack") return { kind: "world" };

	const version = findBestVersionForInstance(
		project,
		versions,
		instance,
		"release",
		installType,
	);
	if (!version) return { kind: "unavailable" };
	return requiresWorldTarget(project, version, installType)
		? { kind: "world", version }
		: { kind: "instance", version };
}
