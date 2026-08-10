import type { ResourceVersion, ResourceVersionFile } from "@stores/resources";

export type ArtifactRole =
	| "datapack"
	| "resourcepack"
	| "world"
	| "primary"
	| "other";

const normalizeRole = (role: string): ArtifactRole => {
	const normalized = role.toLowerCase().replaceAll("-", "").replaceAll("_", "");
	if (normalized === "datapack" || normalized === "datapacks") return "datapack";
	if (
		normalized === "resourcepack" ||
		normalized === "resourcepacks" ||
		normalized === "companionresourcepack"
	) {
		return "resourcepack";
	}
	if (normalized === "world" || normalized === "worlds") return "world";
	if (normalized === "primary") return "primary";
	return "other";
};

export function versionArtifactFiles(
	version: Pick<ResourceVersion, "files" | "download_url" | "file_name" | "hash">,
): ResourceVersionFile[] {
	if (version.files && version.files.length > 0) return version.files;
	if (!version.download_url) return [];
	return [
		{
			url: version.download_url,
			file_name: version.file_name,
			hash: version.hash,
			role: "primary",
		},
	];
}

export function versionArtifactRoles(
	version: Pick<ResourceVersion, "files" | "download_url" | "file_name" | "hash">,
): ArtifactRole[] {
	const roles = new Set<ArtifactRole>();
	for (const file of versionArtifactFiles(version)) {
		roles.add(normalizeRole(file.role));
	}
	return [...roles];
}

export function hasDatapackAndResourcePack(
	version: Pick<ResourceVersion, "files" | "download_url" | "file_name" | "hash">,
): boolean {
	const roles = versionArtifactRoles(version);
	return roles.includes("datapack") && roles.includes("resourcepack");
}

/** Short badges for UI chips, e.g. ["Datapack", "Resource pack"]. */
export function artifactRoleLabels(
	version: Pick<ResourceVersion, "files" | "download_url" | "file_name" | "hash">,
): string[] {
	const roles = versionArtifactRoles(version);
	const labels: string[] = [];
	if (roles.includes("datapack")) labels.push("Datapack");
	if (roles.includes("resourcepack")) labels.push("Resource pack");
	if (roles.includes("world")) labels.push("World");
	if (labels.length === 0 && roles.includes("primary")) labels.push("Primary file");
	return labels;
}

function prettyResourceType(type: string): string {
	switch (type.toLowerCase()) {
		case "datapack":
			return "datapack";
		case "resourcepack":
			return "resource pack";
		case "modpack":
			return "modpack";
		case "shader":
			return "shader";
		case "world":
			return "world";
		case "mod":
			return "mod";
		default:
			return type;
	}
}

/**
 * Labels for the project-level type chip. Prefers `external_ids.artifact_roles`,
 * then unions roles across known versions, then falls back to `resource_type`.
 */
export function projectTypeLabels(
	project: {
		resource_type: string;
		external_ids?: Record<string, string> | null;
	},
	versions?: readonly Pick<
		ResourceVersion,
		"files" | "download_url" | "file_name" | "hash"
	>[],
): string[] {
	const fromExternal = project.external_ids?.artifact_roles
		?.split(",")
		.map((role) => role.trim())
		.filter(Boolean);
	if (fromExternal && fromExternal.length > 0) {
		return fromExternal.map(prettyResourceType);
	}

	if (versions && versions.length > 0) {
		const roles = new Set<ArtifactRole>();
		for (const version of versions) {
			for (const role of versionArtifactRoles(version)) {
				roles.add(role);
			}
		}
		const labels: string[] = [];
		if (roles.has("datapack")) labels.push("datapack");
		if (roles.has("resourcepack")) labels.push("resource pack");
		if (roles.has("world")) labels.push("world");
		if (labels.length > 0) return labels;
	}

	return [prettyResourceType(project.resource_type)];
}

export function projectTypeLabel(
	project: {
		resource_type: string;
		external_ids?: Record<string, string> | null;
	},
	versions?: readonly Pick<
		ResourceVersion,
		"files" | "download_url" | "file_name" | "hash"
	>[],
): string {
	return projectTypeLabels(project, versions).join(" · ");
}

/** One-line summary when a version ships multiple pack sides. */
export function artifactBundleSummary(
	version: Pick<ResourceVersion, "files" | "download_url" | "file_name" | "hash">,
): string | null {
	const labels = artifactRoleLabels(version);
	if (labels.length <= 1) return null;
	if (hasDatapackAndResourcePack(version)) {
		return "Includes datapack & resource pack";
	}
	return `Includes ${labels.join(" + ").toLowerCase()}`;
}

export function versionsShareBundlePattern(
	versions: readonly Pick<
		ResourceVersion,
		"files" | "download_url" | "file_name" | "hash"
	>[],
): string | null {
	for (const version of versions) {
		const summary = artifactBundleSummary(version);
		if (summary) return summary;
	}
	return null;
}
