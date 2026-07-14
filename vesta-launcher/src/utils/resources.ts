import type { Instance } from "@stores/instances";
import { type ResourceProject, type ResourceVersion } from "@stores/resources";
import { isGameVersionCompatible } from "@utils/resource-install-intent";

export interface CompatibilityResult {
	type: "compatible" | "warning" | "incompatible";
	reason?: string;
}

export const getProjectCompatibilityForInstance = (
	project: ResourceProject,
	instance: Instance,
): CompatibilityResult => {
	const loader = instance.modloader?.toLowerCase() || "";
	const resourceType = project.resource_type;

	if (loader === "" || loader === "vanilla") {
		if (resourceType === "mod" || resourceType === "shader") {
			return {
				type: "incompatible",
				reason: `Vanilla instances do not support ${resourceType}s.`,
			};
		}
		return { type: "compatible" };
	}

	if (
		resourceType === "shader" ||
		resourceType === "resourcepack" ||
		resourceType === "datapack"
	) {
		return { type: "compatible" };
	}

	const categories = new Set(
		project.categories.map((category) => category.toLowerCase()),
	);
	const declaresLoader = ["fabric", "forge", "quilt", "neoforge"].some(
		(category) => categories.has(category),
	);
	if (!declaresLoader) return { type: "compatible" };

	if (categories.has(loader)) return { type: "compatible" };
	if (loader === "quilt" && categories.has("fabric")) {
		return { type: "warning", reason: "Fabric mod on Quilt instance." };
	}
	if (loader === "neoforge" && categories.has("forge")) {
		return { type: "warning", reason: "Forge mod on NeoForge instance." };
	}

	return {
		type: "incompatible",
		reason: `This mod is not compatible with ${instance.modloader || "Vanilla"}.`,
	};
};

export const getCompatibilityForInstance = (
	project: ResourceProject | undefined,
	version: ResourceVersion,
	instance: Instance,
): CompatibilityResult => {
	const instLoader = instance.modloader?.toLowerCase() || "";
	const resType = project?.resource_type;

	// 1. Version check (Most important)
	const matchesVersion = isGameVersionCompatible(
		version.game_versions,
		instance.minecraftVersion,
	);
	if (!matchesVersion) {
		return {
			type: "incompatible",
			reason: `Version ${version.version_number} is not compatible with ${instance.minecraftVersion}.`,
		};
	}

	// Vanilla restriction
	if (instLoader === "" || instLoader === "vanilla") {
		if (resType === "mod" || resType === "shader") {
			return {
				type: "incompatible",
				reason: `Vanilla instances do not support ${resType}s.`,
			};
		}
		return { type: "compatible" };
	}

	// Shaders, resource packs, and datapacks are generally compatible across loaders
	if (
		resType === "shader" ||
		resType === "resourcepack" ||
		resType === "datapack"
	)
		return { type: "compatible" };

	const versionLoaders = version.loaders.map((l) => l.toLowerCase());

	if (versionLoaders.includes(instLoader)) return { type: "compatible" };

	if (instLoader === "quilt" && versionLoaders.includes("fabric")) {
		return {
			type: "warning",
			reason: "Fabric version on Quilt instance.",
		};
	}

	if (instLoader === "neoforge" && versionLoaders.includes("forge")) {
		return {
			type: "warning",
			reason: "Forge version on NeoForge instance.",
		};
	}

	// If it's a mod but has no loaders specified, it's ambiguous, assume compatible
	if (versionLoaders.length === 0) return { type: "compatible" };

	return {
		type: "incompatible",
		reason: `This version is for ${version.loaders.join(", ")}.`,
	};
};

export const SHADER_ENGINES = {
	iris: {
		modrinth: "iris",
		curseforge: "445996",
		name: "Iris Shaders",
	},
	oculus: {
		modrinth: "oculus",
		curseforge: "581495",
		name: "Oculus",
	},
};

export interface ShaderEngineInfo {
	id: string;
	source: "modrinth" | "curseforge";
	name: string;
	key: "iris" | "oculus";
}

export const getShaderEnginesInOrder = (
	loader?: string | null,
): ShaderEngineInfo[] => {
	const l = loader?.toLowerCase() || "";

	const iris: ShaderEngineInfo = {
		id: SHADER_ENGINES.iris.modrinth,
		source: "modrinth",
		name: SHADER_ENGINES.iris.name,
		key: "iris",
	};

	const oculus: ShaderEngineInfo = {
		id: SHADER_ENGINES.oculus.modrinth,
		source: "modrinth",
		name: SHADER_ENGINES.oculus.name,
		key: "oculus",
	};

	// Forge ONLY supports Oculus
	if (l === "forge") {
		return [oculus];
	}

	// Fabric/Quilt ONLY supports Iris
	if (l === "fabric" || l === "quilt") {
		return [iris];
	}

	// NeoForge supports both, but user says Iris is preferred
	if (l === "neoforge") {
		return [iris, oculus];
	}

	// Default fallback
	return [iris, oculus];
};
