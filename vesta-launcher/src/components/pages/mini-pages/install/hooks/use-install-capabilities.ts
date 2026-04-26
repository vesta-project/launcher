import type { ResourceVersion } from "@stores/resources";
import { createMemo, type Accessor } from "solid-js";

interface UseInstallCapabilitiesParams {
	modpackInfo: Accessor<{ minecraftVersion: string; modloader: string } | undefined>;
	modpackUrl: Accessor<string>;
	modpackPath: Accessor<string>;
	projectVersions: Accessor<ResourceVersion[] | undefined>;
}

export function useInstallCapabilities(params: UseInstallCapabilitiesParams) {
	const supportedMcVersions = createMemo(() => {
		const info = params.modpackInfo();
		if (info && (params.modpackUrl() || params.modpackPath())) return [info.minecraftVersion];
		return params.projectVersions()?.flatMap((v: ResourceVersion) => v.game_versions) || undefined;
	});

	const supportedModloaders = createMemo(() => {
		const info = params.modpackInfo();
		if (info && (params.modpackUrl() || params.modpackPath())) return [info.modloader.toLowerCase()];
		const versions = params.projectVersions();
		if (versions && versions.length > 0) {
			const set = new Set(["vanilla"]);
			versions.forEach((v: ResourceVersion) => v.loaders.forEach((loader: string) => set.add(loader.toLowerCase())));
			return Array.from(set);
		}
		return undefined;
	});

	return { supportedMcVersions, supportedModloaders };
}
