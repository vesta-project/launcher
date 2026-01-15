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
    release_type: 'release' | 'beta' | 'alpha';
    is_manual: boolean;
    is_enabled: boolean;
    last_updated: string;
    hash?: string;
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
    categories: string[];
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    selectedProject: ResourceProject | null;
    versions: ResourceVersion[];
    installedResources: InstalledResource[];
    installingVersionIds: string[];
    viewMode: 'grid' | 'list';
    showFilters: boolean;
    requestInstallProject: ResourceProject | null;
    requestInstallVersions: ResourceVersion[];
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
    categories: [],
    sortBy: 'relevance',
    sortOrder: 'desc',
    selectedProject: null,
    versions: [],
    installedResources: [],
    installingVersionIds: [],
    viewMode: 'grid',
    showFilters: true,
    requestInstallProject: null,
    requestInstallVersions: []
});

export const resources = {
    state: resourceStore,

    setRequestInstall: (p: ResourceProject | null, versions: ResourceVersion[] = []) => {
        setResourceStore("requestInstallProject", p);
        setResourceStore("requestInstallVersions", versions);
    },

    setQuery: (q: string) => setResourceStore("query", q),
    setSource: (s: SourcePlatform) => {
        setResourceStore("activeSource", s);
        setResourceStore("sortBy", s === 'modrinth' ? 'relevance' : 'featured');
        setResourceStore("categories", []);
        setResourceStore("offset", 0);
    },
    setType: (t: ResourceType) => {
        setResourceStore("resourceType", t);
        setResourceStore("offset", 0);
        setResourceStore("categories", []);
        // Clear loader if not on 'mod' as it doesn't apply to resourcepacks/shaders
        if (t !== 'mod') {
            setResourceStore("loader", null);
        }
    },
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
    setCategories: (c: string[]) => setResourceStore("categories", c),
    toggleCategory: (c: string) => {
        const current = resourceStore.categories;
        if (current.includes(c)) {
            setResourceStore("categories", current.filter(cat => cat !== c));
        } else {
            setResourceStore("categories", [...current, c]);
        }
    },
    setSortBy: (s: string) => setResourceStore("sortBy", s),
    setSortOrder: (o: 'asc' | 'desc') => setResourceStore("sortOrder", o),
    setLimit: (l: number) => {
        setResourceStore("limit", l);
        setResourceStore("offset", 0);
    },
    toggleSortOrder: () => setResourceStore("sortOrder", o => o === 'asc' ? 'desc' : 'asc'),
    setViewMode: (m: 'grid' | 'list') => setResourceStore("viewMode", m),
    toggleFilters: () => setResourceStore("showFilters", show => !show),
    setOffset: (o: number) => setResourceStore("offset", o),
    setPage: (p: number) => setResourceStore("offset", (p - 1) * resourceStore.limit),

    resetFilters: () => {
        setResourceStore({
            query: "",
            categories: [],
            gameVersion: null,
            loader: null,
            offset: 0,
            sortBy: resourceStore.activeSource === 'modrinth' ? 'relevance' : 'featured',
            sortOrder: 'desc'
        });
        resources.search();
    },

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
                    categories: resourceStore.categories.length > 0 ? resourceStore.categories : null,
                    sort_by: resourceStore.sortBy,
                    sort_order: resourceStore.sortOrder
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

    getVersions: async (platform: SourcePlatform, projectId: string, ignoreCache: boolean = false) => {
        return await invoke<ResourceVersion[]>("get_resource_versions", { 
            platform, 
            projectId,
            ignoreCache 
        });
    },

    install: async (project: ResourceProject, version: ResourceVersion, targetInstanceId?: number | null) => {
        const isModpack = project.resource_type === 'modpack';
        const instanceId = targetInstanceId !== undefined ? targetInstanceId : resourceStore.selectedInstanceId;
        
        if (!instanceId && !isModpack) return;
        
        // Immediate UI feedback
        setResourceStore("installingVersionIds", ids => [...ids, version.id]);

        try {
            const result = await invoke<string>("install_resource", {
                instanceId: instanceId || 0,
                platform: project.source,
                projectId: project.id,
                projectName: project.name,
                version,
                resourceType: project.resource_type
            });

            // Remove from installing list on success
            setResourceStore("installingVersionIds", ids => ids.filter(id => id !== version.id));

            // Refresh installed list after a short delay to allow DB/File system to sync
            setTimeout(() => {
                if (instanceId) {
                    resources.fetchInstalled(instanceId);
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
    },

    uninstall: async (instanceId: number, resourceId: number) => {
        await invoke("delete_resource", { instanceId, resourceId });
        await resources.fetchInstalled(instanceId);
    }
};

export function findBestVersion(
    versions: ResourceVersion[], 
    gameVersion: string, 
    modloader: string | null,
    currentReleaseType?: 'release' | 'beta' | 'alpha',
    resourceType?: ResourceType
): ResourceVersion | null {
    // Filter by game version and loader
    // Some platforms use different casing, lower-case for comparison
    const instLoader = modloader?.toLowerCase() || "";
    
    // If currentReleaseType is unknown, we default to only looking for releases to be safe
    const allowedReleaseTypes = (currentReleaseType === 'release' || !currentReleaseType) 
        ? ['release'] 
        : (currentReleaseType === 'beta' ? ['release', 'beta'] : ['release', 'beta', 'alpha']);

    const compatible = versions.filter(v => {
        const matchesVersion = v.game_versions.includes(gameVersion);
        
        // Loader logic
        const normalizedLoaders = v.loaders.map(l => l.toLowerCase());
        let matchesLoader = false;
        
        if (resourceType === 'shader' || resourceType === 'resourcepack' || resourceType === 'datapack') {
            matchesLoader = true; // Universal
            
            // Shaders require a loader (Iris/Oculus) so they are NOT compatible with vanilla
            if (resourceType === 'shader' && (instLoader === "" || instLoader === "vanilla")) {
                matchesLoader = false;
            }
        } else {
            // For mods, vanilla does NOT match unless it's a specific "minecraft" engine mod
            const isVanilla = instLoader === "" || instLoader === "vanilla";
            if (isVanilla) {
                // True mods (jar mods) are not compatible with Vanilla
                if (resourceType === 'mod') {
                    matchesLoader = false;
                } else {
                    matchesLoader = normalizedLoaders.length === 0 || normalizedLoaders.includes("minecraft");
                }
            } else {
                matchesLoader = normalizedLoaders.some(l => l === instLoader);
            }
            
            // Quilt can run Fabric mods
            if (!matchesLoader && instLoader === "quilt") {
                matchesLoader = normalizedLoaders.includes("fabric");
            }

            // NeoForge can run Forge mods
            if (!matchesLoader && instLoader === "neoforge") {
                matchesLoader = normalizedLoaders.includes("forge");
            }
        }
        
        const matchesStability = allowedReleaseTypes.includes(v.release_type);
        
        return matchesVersion && matchesLoader && matchesStability;
    });

    if (compatible.length === 0) return null;

    // The API normally returns versions newest -> oldest. 
    // We want the newest one that fits our criteria.
    // If not on 'release' mode, we still prefer 'release' over 'beta' if both are compatible.
    
    const releases = compatible.filter(v => v.release_type === 'release');
    if (releases.length > 0) return releases[0];
    
    const betas = compatible.filter(v => v.release_type === 'beta');
    if (betas.length > 0) return betas[0];

    return compatible[0] || null;
}

