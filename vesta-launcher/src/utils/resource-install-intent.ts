import type { Instance } from "@stores/instances";
import type {
	InstalledResource,
	ResourceProject,
	ResourceType,
	ResourceVersion,
	SourcePlatform,
} from "@stores/resources";

export interface ResourceInstallRequest {
	project: ResourceProject;
	versions: ResourceVersion[];
	version?: ResourceVersion;
	preferredInstanceId?: number;
}

export interface PendingResourceInstall {
	project: ResourceProject;
	version?: ResourceVersion;
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
): boolean {
	if (project.resource_type === "datapack") return true;
	return (version?.files ?? []).some((file) => {
		const role = normalizeArtifactRole(file.role);
		return (
			role === "datapack" ||
			(role === "primary" && project.resource_type === "datapack")
		);
	});
}

export function isGameVersionCompatible(
	supported: readonly string[],
	target: string,
): boolean {
	const normalize = (version: string) =>
		version.endsWith(".0") ? version.slice(0, -2) : version;
	const normalizedTarget = normalize(target);
	const targetMajorMinor = normalizedTarget.split(".").slice(0, 2).join(".");

	return supported.some((version) => {
		const normalizedVersion = normalize(version);
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
		if (!versionMatchesResourceType(resourceType, version, source)) return false;
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
): ResourceVersion | null {
	return findBestVersion(
		versions,
		instance.minecraftVersion,
		instance.modloader,
		releaseType,
		project.resource_type,
		project.source,
	);
}
