import type { Instance } from "@stores/instances";
import type { ResourceProject, ResourceVersion } from "@stores/resources";
import { versionMatchesResourceType } from "@utils/resource-install-intent";
import { getCompatibilityForInstance } from "@utils/resources";
import { sanitizeHtml } from "@utils/security";
import { marked } from "marked";

function compareVersionLabels(left: string, right: string): number {
	return left.localeCompare(right, undefined, {
		numeric: true,
		sensitivity: "base",
	});
}

const NON_MINECRAFT_VERSION_LABELS = new Set(["client", "server"]);

export function minecraftGameVersions(
	gameVersions: readonly string[],
): string[] {
	return Array.from(
		new Set(
			gameVersions.filter(
				(version) =>
					!NON_MINECRAFT_VERSION_LABELS.has(version.trim().toLowerCase()),
			),
		),
	).sort(compareVersionLabels);
}

export function summarizeGameVersions(gameVersions: readonly string[]): string {
	const versions = minecraftGameVersions(gameVersions);
	if (versions.length === 0) return "No MC version listed";
	if (versions.length === 1) return `MC ${versions[0]}`;
	if (versions.length <= 3) return `MC ${versions.join(", ")}`;
	return `MC ${versions[0]} — ${versions[versions.length - 1]}`;
}

export function resourceProjectKey(
	project: Pick<ResourceProject, "id" | "source">,
): string {
	return `${project.source}:${project.id}`;
}

export function currentPeerProject(
	project: Pick<ResourceProject, "id" | "source"> | undefined,
	lookup:
		| {
				ownerKey: string;
				peer: ResourceProject | null;
		  }
		| undefined,
): ResourceProject | null {
	if (!project || !lookup || lookup.ownerKey !== resourceProjectKey(project)) {
		return null;
	}
	return lookup.peer;
}

export function renderVersionChangelog(
	changelog: string | null | undefined,
	format: "markdown" | "html",
): string {
	if (!changelog) return "";
	const html =
		format === "markdown"
			? String(marked.parse(changelog, { gfm: true }))
			: changelog;
	return sanitizeHtml(html);
}

export function versionsSupportedByInstance(
	project: ResourceProject | undefined,
	versions: readonly ResourceVersion[],
	instance: Instance | null | undefined,
): ResourceVersion[] {
	const matchingProjectType = versions.filter((version) =>
		versionMatchesResourceType(
			project?.resource_type,
			version,
			project?.source,
		),
	);
	if (!instance || project?.resource_type === "modpack") {
		return matchingProjectType;
	}
	return matchingProjectType.filter(
		(version) =>
			getCompatibilityForInstance(project, version, instance).type !==
			"incompatible",
	);
}
