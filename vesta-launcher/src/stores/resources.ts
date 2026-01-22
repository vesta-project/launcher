import { createStore, reconcile } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
    gallery: string[];
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
    dependencies: ResourceDependency[];
};

export type ResourceDependency = {
    project_id: string;
    version_id: string | null;
    file_name: string | null;
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
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
    installingProjectIds: string[];
    viewMode: 'grid' | 'list';
    showFilters: boolean;
    requestInstallProject: ResourceProject | null;
    requestInstallVersions: ResourceVersion[];
    selection: Record<string, boolean>;
    sorting: { id: string; desc: boolean }[];
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
    installingProjectIds: [],
    viewMode: 'grid',
    showFilters: true,
    requestInstallProject: null,
    requestInstallVersions: [],
    selection: {},
    sorting: [{ id: 'display_name', desc: false }],
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
    setGameVersion: (v: string | null) => {
        setResourceStore("gameVersion", v);
        setResourceStore("offset", 0);
    },
    setLoader: (l: string | null) => {
        setResourceStore("loader", l);
        setResourceStore("offset", 0);
    },
    setCategories: (c: string[]) => {
        setResourceStore("categories", c);
        setResourceStore("offset", 0);
    },
    toggleCategory: (c: string) => {
        const current = resourceStore.categories;
        if (current.includes(c)) {
            setResourceStore("categories", current.filter(cat => cat !== c));
        } else {
            setResourceStore("categories", [...current, c]);
        }
        setResourceStore("offset", 0);
    },
    setSortBy: (s: string) => {
        setResourceStore("sortBy", s);
        setResourceStore("offset", 0);
    },
    setSortOrder: (o: 'asc' | 'desc') => {
        setResourceStore("sortOrder", o);
        setResourceStore("offset", 0);
    },
    setLimit: (l: number) => {
        setResourceStore("limit", l);
        setResourceStore("offset", 0);
    },
    toggleSortOrder: () => setResourceStore("sortOrder", o => o === 'asc' ? 'desc' : 'asc'),
    setViewMode: (m: 'grid' | 'list') => setResourceStore("viewMode", m),
    toggleFilters: () => setResourceStore("showFilters", show => !show),
    setOffset: (o: number) => setResourceStore("offset", o),
    setPage: (p: number) => setResourceStore("offset", (p - 1) * resourceStore.limit),
    
    toggleSelection: (id: string) => setResourceStore("selection", id, (s) => !s),
    batchSetSelection: (selection: Record<string, boolean>) => {
        setResourceStore("selection", reconcile(selection));
    },
    clearSelection: () => setResourceStore("selection", reconcile({})),
    setSorting: (sorting: { id: string; desc: boolean }[]) => setResourceStore("sorting", sorting),
    
    // Legacy helper if needed elsewhere
    setBatchSelected: (ids: string[], selected: boolean) => {
        const newSelection = { ...resourceStore.selection };
        for (const id of ids) {
            newSelection[id] = selected;
        }
        setResourceStore("selection", newSelection);
    },

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
                // Fetch versions - use ignoreCache: true to ensure we get the expanded (>50) list
                // if we previously only cached 50.
                const versions = await resources.getVersions(project.source, project.id, true);
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

    getProjects: async (platform: SourcePlatform, ids: string[]) => {
        if (ids.length === 0) return [];
        return await invoke<ResourceProject[]>("get_resource_projects", { platform, ids });
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
        setResourceStore("installingProjectIds", ids => [...ids, project.id]);

        try {
            // Cache project metadata for future offline/icon use
            await invoke("cache_resource_metadata", {
                platform: resourceStore.activeSource,
                project: project
            });

            const result = await invoke<string>("install_resource", {
                instanceId: instanceId || 0,
                platform: project.source,
                projectId: project.id,
                projectName: project.name,
                version,
                resourceType: project.resource_type
            });

            // We DO NOT clear the installing IDs here anymore.
            // They will be cleared by fetchInstalled once the ResourceWatcher
            // detects the new file and updates the database.

            // Request an initial refresh after a short delay, but the event listener
            // will handle the real completion signal.
            setTimeout(() => {
                if (instanceId) {
                    resources.fetchInstalled(instanceId);
                }
            }, 1000);

            return result;
        } catch (e) {
            // Remove from installing list ONLY on error
            setResourceStore("installingVersionIds", ids => ids.filter(id => id !== version.id));
            setResourceStore("installingProjectIds", ids => ids.filter(id => id !== project.id));
            throw e;
        }
    },

    getInstalled: async (instanceId: number) => {
        return await invoke<InstalledResource[]>("get_installed_resources", { instanceId });
    },

    fetchInstalled: async (instanceId: number) => {
        const results = await invoke<InstalledResource[]>("get_installed_resources", { instanceId });
        setResourceStore("installedResources", results);
        
        // Clear any installing IDs that are now in the results.
        // This is the source of truth for when an installation is "finished".
        const installedRemoteVersionIds = results.map(r => r.remote_version_id);
        const installedRemoteIds = results.map(r => r.remote_id.toLowerCase());

        setResourceStore("installingVersionIds", ids => ids.filter(id => !installedRemoteVersionIds.includes(id)));
        setResourceStore("installingProjectIds", ids => ids.filter(id => !installedRemoteIds.includes(id.toLowerCase())));

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

// Listen for resource updates from the backend (watcher)
if (typeof window !== 'undefined') {
    listen("resources-updated", (event) => {
        const instanceId = event.payload as number;
        if (resourceStore.selectedInstanceId === instanceId) {
            resources.fetchInstalled(instanceId);
        }
    });

    listen("resource-install-error", (event) => {
        const taskId = event.payload as string;
        // Format: download_{instance_id}_{project_id}_{version_id}
        const parts = taskId.split('_');
        if (parts.length >= 4 && parts[0] === 'download') {
            const projectId = parts[2];
            const versionId = parts[3];

            setResourceStore("installingProjectIds", ids => ids.filter(id => id !== projectId));
            setResourceStore("installingVersionIds", ids => ids.filter(id => id !== versionId));
        }
    });
}

export function isGameVersionCompatible(supported: string[], target: string): boolean {
    // Normalize versions to handle 1.21 vs 1.21.0 consistently
    // We normalize both to X.Y for comparison, but we must be careful with patches.
    const normalize = (v: string) => v.endsWith(".0") ? v.slice(0, -2) : v;
    const nTarget = normalize(target);
    const targetParts = nTarget.split('.');
    
    // Major.Minor group of the target (e.g., "1.21" from "1.21.4")
    const targetMajorMinor = targetParts.slice(0, 2).join('.');
    
    for (const s of supported) {
        const ns = normalize(s);
        
        // 1. Exact match (including normalized 1.21 vs 1.21.0)
        if (ns === nTarget) return true;
        
        // 2. Explicit wildcard match (e.g., "1.21.x")
        if (ns === `${targetMajorMinor}.x`) return true;
        
        // 3. Range support (if we implement it later, e.g., "[1.21, 1.21.2]")
        // (Not implemented yet)

        // Note: We NO LONGER allow a bare "1.21" to match "1.21.4" by default.
        // If a mod supports "1.21.x", it should be tagged as such or list all patches.
        // This prevents the "mod for 1.21 and 1.21.1 doesn't match 1.21.11" issue.
    }
    
    return false;
}

export function findBestVersion(
    versions: ResourceVersion[], 
    gameVersion: string, 
    modloader: string | null,
    currentReleaseType?: 'release' | 'beta' | 'alpha',
    resourceType?: ResourceType
): ResourceVersion | null {
    // Filter by game version and loader
    const instLoader = modloader?.toLowerCase() || "";
    
    const allowedReleaseTypes = (currentReleaseType === 'release' || !currentReleaseType) 
        ? ['release'] 
        : (currentReleaseType === 'beta' ? ['release', 'beta'] : ['release', 'beta', 'alpha']);

    const compatible = versions.filter(v => {
        const matchesVersion = isGameVersionCompatible(v.game_versions, gameVersion);
        
        // Loader logic
        const normalizedLoaders = v.loaders.map(l => l.toLowerCase());
        let matchesLoader = false;
        
        if (resourceType === 'shader' || resourceType === 'resourcepack' || resourceType === 'datapack') {
            matchesLoader = true;
            if (resourceType === 'shader' && (instLoader === "" || instLoader === "vanilla")) {
                matchesLoader = false;
            }
        } else {
            const isVanilla = instLoader === "" || instLoader === "vanilla";
            if (isVanilla) {
                if (resourceType === 'mod') {
                    matchesLoader = false;
                } else {
                    matchesLoader = normalizedLoaders.length === 0 || normalizedLoaders.includes("minecraft");
                }
            } else {
                matchesLoader = normalizedLoaders.some(l => l === instLoader);
            }
            
            if (!matchesLoader && instLoader === "quilt") {
                matchesLoader = normalizedLoaders.includes("fabric");
            }
            if (!matchesLoader && instLoader === "neoforge") {
                matchesLoader = normalizedLoaders.includes("forge");
            }
        }
        
        const matchesStability = allowedReleaseTypes.includes(v.release_type);
        
        return matchesVersion && matchesLoader && matchesStability;
    });

    if (compatible.length === 0) return null;

    // Sort compatible versions:
    // 1. Prefer explicit version match over fuzzy prefix match
    // 2. Prefer release over beta/alpha
    // 3. Prefer most recent version (by ID or list order)
    
    const sorted = [...compatible].sort((a, b) => {
        const aExplicit = a.game_versions.includes(gameVersion);
        const bExplicit = b.game_versions.includes(gameVersion);
        
        if (aExplicit && !bExplicit) return -1;
        if (!aExplicit && bExplicit) return 1;
        
        // Then by stability
        const stabilityOrder = { 'release': 0, 'beta': 1, 'alpha': 2 };
        const aStab = stabilityOrder[a.release_type] ?? 99;
        const bStab = stabilityOrder[b.release_type] ?? 99;
        
        if (aStab !== bStab) return aStab - bStab;
        
        // Same stability and explicit/fuzzy status, stick with original order (usually newest first from API)
        return 0;
    });

    return sorted[0] || null;
}

