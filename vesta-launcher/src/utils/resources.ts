import { ResourceProject, ResourceVersion, isGameVersionCompatible } from "@stores/resources";
import type { Instance } from "@stores/instances";

export interface CompatibilityResult {
    type: 'compatible' | 'warning' | 'incompatible';
    reason?: string;
}

export const getCompatibilityForInstance = (
    project: ResourceProject | undefined, 
    version: ResourceVersion, 
    instance: Instance
): CompatibilityResult => {
    const instLoader = instance.modloader?.toLowerCase() || "";
    const resType = project?.resource_type;

    // 1. Version check (Most important)
    const matchesVersion = isGameVersionCompatible(version.game_versions, instance.minecraftVersion);
    if (!matchesVersion) {
        return {
            type: 'incompatible',
            reason: `Version ${version.version_number} is not compatible with ${instance.minecraftVersion}.`
        };
    }

    // Vanilla restriction
    if (instLoader === "" || instLoader === "vanilla") {
        if (resType === 'mod' || resType === 'shader') {
            return { 
                type: 'incompatible', 
                reason: `Vanilla instances do not support ${resType}s.`
            };
        }
        return { type: 'compatible' };
    }

    // Shaders, resource packs, and datapacks are generally compatible across loaders
    if (resType === 'shader' || resType === 'resourcepack' || resType === 'datapack') return { type: 'compatible' };

    const versionLoaders = version.loaders.map(l => l.toLowerCase());

    if (versionLoaders.includes(instLoader)) return { type: 'compatible' };
    
    if (instLoader === "quilt" && versionLoaders.includes("fabric")) {
        return { 
            type: 'warning', 
            reason: "Fabric version on Quilt instance."
        };
    }

    if (instLoader === "neoforge" && versionLoaders.includes("forge")) {
        return { 
            type: 'warning', 
            reason: "Forge version on NeoForge instance."
        };
    }
    
    // If it's a mod but has no loaders specified, it's ambiguous, assume compatible
    if (versionLoaders.length === 0) return { type: 'compatible' };

    return { 
        type: 'incompatible', 
        reason: `This version is for ${version.loaders.join(', ')}.` 
    };
};

export const SHADER_ENGINES = {
    iris: {
        modrinth: 'iris',
        curseforge: '445996',
        name: 'Iris Shaders'
    },
    oculus: {
        modrinth: 'oculus',
        curseforge: '581495',
        name: 'Oculus'
    }
};

export interface ShaderEngineInfo {
    id: string;
    source: 'modrinth' | 'curseforge';
    name: string;
    key: 'iris' | 'oculus';
}

export const getShaderEnginesInOrder = (loader?: string | null): ShaderEngineInfo[] => {
    const l = loader?.toLowerCase() || "";
    
    const iris: ShaderEngineInfo = { 
        id: SHADER_ENGINES.iris.modrinth, 
        source: 'modrinth', 
        name: SHADER_ENGINES.iris.name,
        key: 'iris'
    };
    
    const oculus: ShaderEngineInfo = { 
        id: SHADER_ENGINES.oculus.modrinth, 
        source: 'modrinth', 
        name: SHADER_ENGINES.oculus.name,
        key: 'oculus'
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

