import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { Instance } from "./instances";

export type ResourceType = 'mod' | 'resourcepack' | 'shader' | 'datapack' | 'modpack';
export type SourcePlatform = 'modrinth' | 'curseforge';
// ... (rest of imports)

export type ResourceProject = {
    id: string;
    source: SourcePlatform;
    resource_type: ResourceType;
    name: string;
    summary: string;
    description: string | null;
    icon_url: string | null;
    author: string;
    download_count: number;
    follower_count: number;
    categories: string[];
    web_url: string;
    external_ids?: Record<string, string>;
    screenshots: string[];
    published_at: string | null;
    updated_at: string | null;
};

export type SearchResponse = {
    hits: ResourceProject[];
    total_hits: number;
};

export type ResourceVersion = {
    id: string;
    project_id: string;
    version_number: string;
    game_versions: string[];
    loaders: string[];
    download_url: string;
    file_name: string;
    release_type: 'release' | 'beta' | 'alpha';
    hash: string;
};

export type InstalledResource = {
    id: number;
    instance_id: number;
    platform: string;
    remote_id: string;
    remote_version_id: string;
    resource_type: string;
    local_path: string;
    display_name: string;
    current_version: string;
    is_manual: boolean;
    is_enabled: boolean;
    last_updated: string;
};

type ResourceStoreState = {
    query: string;
    results: ResourceProject[];
    totalHits: number;
    loading: boolean;
    activeSource: SourcePlatform;
    resourceType: ResourceType;
    selectedInstanceId: number | null;
    offset: number;
    limit: number;
    gameVersion: string | null;
    loader: string | null;
    selectedProject: ResourceProject | null;
    versions: ResourceVersion[];
    installedResources: InstalledResource[];
    installingVersionIds: string[];
};

const [resourceStore, setResourceStore] = createStore<ResourceStoreState>({
    query: "",
    results: [],
    totalHits: 0,
    loading: false,
    activeSource: 'modrinth',
    resourceType: 'mod',
    selectedInstanceId: null,
    offset: 0,
    limit: 20,
    gameVersion: null,
    loader: null,
    selectedProject: null,
    versions: [],
    installedResources: [],
    installingVersionIds: []
});

export const resources = {
    state: resourceStore,

    setQuery: (q: string) => setResourceStore("query", q),
    setSource: (s: SourcePlatform) => setResourceStore("activeSource", s),
    setType: (t: ResourceType) => setResourceStore("resourceType", t),
    setInstance: (id: number | null) => {
        setResourceStore("selectedInstanceId", id);
        if (id) {
            resources.fetchInstalled(id);
        } else {
            setResourceStore("installedResources", []);
        }
    },
    setGameVersion: (v: string | null) => setResourceStore("gameVersion", v),
    setLoader: (l: string | null) => setResourceStore("loader", l),
    setOffset: (o: number) => setResourceStore("offset", o),
    setPage: (p: number) => setResourceStore("offset", (p - 1) * resourceStore.limit),

    selectProject: async (project: ResourceProject | null) => {
        setResourceStore("selectedProject", project);
        if (project) {
            setResourceStore("loading", true);
            try {
                const versions = await resources.getVersions(project.source, project.id);
                setResourceStore("versions", versions);
            } catch (e) {
                console.error("Failed to fetch versions:", e);
                setResourceStore("versions", []);
            } finally {
                setResourceStore("loading", false);
            }
        } else {
            setResourceStore("versions", []);
        }
    },

    search: async () => {
        setResourceStore("loading", true);
        try {
            const response = await invoke<SearchResponse>("search_resources", {
                platform: resourceStore.activeSource,
                query: {
                    text: resourceStore.query || null,
                    resource_type: resourceStore.resourceType,
                    offset: resourceStore.offset,
                    limit: resourceStore.limit,
                    game_version: resourceStore.gameVersion,
                    loader: resourceStore.loader,
                    category: null
                }
            });
            setResourceStore({
                results: response.hits,
                totalHits: response.total_hits
            });
        } catch (e) {
            console.error("Failed to search resources:", e);
        } finally {
            setResourceStore("loading", false);
        }
    },

    getProject: async (platform: SourcePlatform, id: string) => {
        return await invoke<ResourceProject>("get_resource_project", { platform, id });
    },

    getVersions: async (platform: SourcePlatform, projectId: string) => {
        return await invoke<ResourceVersion[]>("get_resource_versions", { platform, projectId });
    },

    install: async (project: ResourceProject, version: ResourceVersion) => {
        if (!resourceStore.selectedInstanceId) return;
        
        // Immediate UI feedback
        setResourceStore("installingVersionIds", ids => [...ids, version.id]);

        try {
            const result = await invoke<string>("install_resource", {
                instanceId: resourceStore.selectedInstanceId,
                platform: project.source,
                projectId: project.id,
                projectName: project.name,
                version,
                resourceType: project.resource_type
            });

            // Refresh installed list after a short delay to allow DB/File system to sync
            setTimeout(() => {
                if (resourceStore.selectedInstanceId) {
                    resources.fetchInstalled(resourceStore.selectedInstanceId);
                }
            }, 1000);

            return result;
        } catch (e) {
            // Remove from installing list on error
            setResourceStore("installingVersionIds", ids => ids.filter(id => id !== version.id));
            throw e;
        }
    },

    getInstalled: async (instanceId: number) => {
        return await invoke<InstalledResource[]>("get_installed_resources", { instanceId });
    },

    fetchInstalled: async (instanceId: number) => {
        const results = await invoke<InstalledResource[]>("get_installed_resources", { instanceId });
        setResourceStore("installedResources", results);
        
        // Clear any installing IDs that are now in the results or just clear them all for this instance
        // Best approach: If we fetched new data, we can assume matching IDs are no longer "installing"
        const installedRemoteVersionIds = results.map(r => r.remote_version_id);
        setResourceStore("installingVersionIds", ids => ids.filter(id => !installedRemoteVersionIds.includes(id)));

        return results;
    },

    sync: async (instanceId: number, instanceSlug: string, gameDir: string) => {
        return await invoke<void>("sync_instance_resources", { instanceId, instanceSlug, gameDir });
    }
};

export function findBestVersion(versions: ResourceVersion[], gameVersion: string, modloader: string | null): ResourceVersion | null {
    // Filter by game version and loader
    // Some platforms use different casing, lower-case for comparison
    const instLoader = modloader?.toLowerCase() || "";
    
    console.log(`Finding best version for MC: ${gameVersion}, Loader: ${instLoader}`);
    console.log(`Available versions: ${versions.length}`);

    const compatible = versions.filter(v => {
        const matchesVersion = v.game_versions.includes(gameVersion);
        
        let matchesLoader = instLoader === "" || v.loaders.some(l => l.toLowerCase() === instLoader);
        
        // Quilt can run Fabric mods
        if (!matchesLoader && instLoader === "quilt") {
            matchesLoader = v.loaders.some(l => l.toLowerCase() === "fabric");
        }
        
        // Debug first few versions
        if (versions.indexOf(v) < 3) {
            console.log(`Version ${v.version_number}: matchesVersion=${matchesVersion}, matchesLoader=${matchesLoader} (v.loaders: ${v.loaders})`);
        }
        
        return matchesVersion && matchesLoader;
    });

    console.log(`Compatible versions found: ${compatible.length}`);
    
    // Sort by release type (Release > Beta > Alpha)
    const releases = compatible.filter(v => v.release_type === 'release');
    if (releases.length > 0) return releases[0];
    
    const betas = compatible.filter(v => v.release_type === 'beta');
    if (betas.length > 0) return betas[0];

    return compatible[0] || null;
}

