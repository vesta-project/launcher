import type {
	InstalledResource,
	ResourceProject,
	ResourceVersion,
} from "@stores/resources";

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
): T | undefined {
	const projectIds = new Set(
		[project.id, ...Object.values(project.external_ids || {})].map((id) =>
			id.toLowerCase(),
		),
	);
	const projectName = project.name.toLowerCase();

	return installed.find((resource) => {
		if (projectIds.has(resource.remote_id.toLowerCase())) return true;
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
