import { buildInstanceInstallPayload } from "@utils/instance-draft";
import {
	DEFAULT_ICONS,
	getStableIconId,
	type Instance,
} from "@utils/instances";

export interface FirstModpackProject {
	id: string;
	name: string;
	iconUrl: string | null;
	platform: "modrinth" | "curseforge";
}

export interface FirstModpackVersion {
	id: string;
	game_versions: string[];
	loaders: string[];
	download_url: string;
	release_type: "release" | "beta" | "alpha";
}

interface FirstModpackInstallDependencies {
	getVersions: (project: FirstModpackProject) => Promise<FirstModpackVersion[]>;
	queueInstall: (url: string, payload: Partial<Instance>) => Promise<number>;
	completeOnboarding: () => Promise<void>;
	goNext: () => Promise<void>;
}

export function selectLatestStableModpackVersion(
	versions: FirstModpackVersion[],
): FirstModpackVersion | undefined {
	const downloadable = versions.filter((version) => !!version.download_url);
	return (
		downloadable.find((version) => version.release_type === "release") ||
		downloadable[0]
	);
}

export async function installFirstModpack(
	project: FirstModpackProject,
	dependencies: FirstModpackInstallDependencies,
): Promise<number> {
	const versions = await dependencies.getVersions(project);
	const version = selectLatestStableModpackVersion(versions);
	if (!version)
		throw new Error("No downloadable versions found for this modpack");

	const payload = buildInstanceInstallPayload(
		{
			name: project.name,
			iconPath:
				project.iconUrl ||
				getStableIconId(DEFAULT_ICONS[0]) ||
				DEFAULT_ICONS[0],
			minecraftVersion: version.game_versions[0] || "",
			modloader: version.loaders[0] || "vanilla",
			modloaderVersion: "",
			minMemory: 2048,
			maxMemory: 4096,
		},
		{
			isModpack: true,
			projectId: project.id,
			platform: project.platform,
			versionId: version.id,
		},
	);

	const instanceId = await dependencies.queueInstall(
		version.download_url,
		payload,
	);
	await dependencies.completeOnboarding();
	await dependencies.goNext();
	return instanceId;
}
