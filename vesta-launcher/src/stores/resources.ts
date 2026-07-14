import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ResourceInstallRequest } from "@utils/resource-install-intent";
import { createStore, reconcile } from "solid-js/store";
import { Instance } from "./instances";

export type ResourceType =
	| "mod"
	| "resourcepack"
	| "shader"
	| "datapack"
	| "modpack"
	| "world";
export type SourcePlatform = "modrinth" | "curseforge";
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
	authors: string[];
	download_count: number;
	follower_count: number;
	categories: string[];
	web_url: string;
	external_ids?: Record<string, string>;
	gallery: string[];
	featured_gallery?: string | null;
	published_at: string | null;
	updated_at: string | null;
};

export type SearchResponse = {
	hits: ResourceProject[];
	total_hits: number;
};

type CachedSearchResponse = SearchResponse & {
	source: SourcePlatform;
	resourceType: ResourceType;
};

export type ResourceCategory = {
	id: string;
	name: string;
	icon_url: string | null;
	project_type: ResourceType | null;
	parent_id: string | null;
	display_index: number | null;
};

export type ResourceVersion = {
	id: string;
	project_id: string;
	version_number: string;
	game_versions: string[];
	loaders: string[];
	download_url: string;
	file_name: string;
	release_type: "release" | "beta" | "alpha";
	hash: string;
	dependencies: ResourceDependency[];
};

export type ResourceDependency = {
	project_id: string;
	version_id: string | null;
	file_name: string | null;
	dependency_type: "required" | "optional" | "incompatible" | "embedded";
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
	release_type: "release" | "beta" | "alpha";
	is_manual: boolean;
	is_enabled: boolean;
	last_updated: string;
	hash?: string;
	source_kind?: "modpack" | "custom" | string;
	source_modpack_id?: string | null;
	source_modpack_version_id?: string | null;
	source_modpack_platform?: string | null;
};

type ResourceStoreState = {
	query: string;
	results: ResourceProject[];
	totalHits: number;
	loading: boolean; // browse search in flight
	versionsLoading: boolean; // resource-details version list in flight
	searchError: string | null;
	searchWarning: string | null;
	activeSource: SourcePlatform;
	resourceType: ResourceType;
	selectedInstanceId: number | null;
	offset: number;
	limit: number;
	gameVersion: string | null;
	loader: string | null;
	categories: string[];
	availableCategories: ResourceCategory[];
	expandedCategoryGroups: string[];
	sortBy: string;
	sortOrder: "asc" | "desc";
	selectedProject: ResourceProject | null;
	versions: ResourceVersion[];
	installedResources: InstalledResource[];
	installingVersionIds: string[];
	installingProjectIds: string[];
	viewMode: "grid" | "list";
	showFilters: boolean;
	reconcilingCategories: boolean;
	installRequest: ResourceInstallRequest | null;
	selection: Record<string, boolean>;
	sorting: { id: string; desc: boolean }[];
};

const [resourceStore, setResourceStore] = createStore<ResourceStoreState>({
	query: "",
	results: [],
	totalHits: 0,
	loading: false,
	versionsLoading: false,
	searchError: null,
	searchWarning: null,
	activeSource: "modrinth",
	resourceType: "mod",
	selectedInstanceId: null,
	offset: 0,
	limit: 20,
	gameVersion: null,
	loader: null,
	categories: [],
	availableCategories: [],
	expandedCategoryGroups: [],
	sortBy: "relevance",
	sortOrder: "desc",
	selectedProject: null,
	versions: [],
	installedResources: [],
	installingVersionIds: [],
	installingProjectIds: [],
	viewMode: "grid",
	showFilters: true,
	reconcilingCategories: false,
	installRequest: null,
	selection: {},
	sorting: [{ id: "display_name", desc: false }],
});

const searchCache = new Map<string, CachedSearchResponse>();

function normalizedSearchValue(value: string | null | undefined) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function currentSearchCacheKey() {
	return JSON.stringify({
		source: resourceStore.activeSource,
		type: resourceStore.resourceType,
		query: normalizedSearchValue(resourceStore.query),
		offset: resourceStore.offset,
		limit: resourceStore.limit,
		gameVersion: normalizedSearchValue(resourceStore.gameVersion),
		loader: normalizedSearchValue(resourceStore.loader),
		categories: [...resourceStore.categories].sort(),
		sortBy: normalizedSearchValue(resourceStore.sortBy),
		sortOrder: resourceStore.sortOrder || "desc",
	});
}

export const resources = {
	state: resourceStore,

	setInstallRequest: (request: ResourceInstallRequest | null) =>
		setResourceStore("installRequest", request),

	setQuery: (q: string) => setResourceStore("query", q),
	setSource: (s: SourcePlatform) => {
		setResourceStore("reconcilingCategories", true);
		setResourceStore("activeSource", s);
		setResourceStore("availableCategories", []);
		setResourceStore("sortBy", s === "modrinth" ? "relevance" : "featured");
		setResourceStore("categories", []);
		setResourceStore("offset", 0);

		// Modrinth doesn't support Worlds
		if (s === "modrinth" && resourceStore.resourceType === "world") {
			setResourceStore("resourceType", "mod");
		}

		resources.fetchCategories();
	},
	setType: (t: ResourceType) => {
		setResourceStore("reconcilingCategories", true);
		setResourceStore("resourceType", t);
		setResourceStore("availableCategories", []);
		setResourceStore("offset", 0);

		// Clear loader if not on 'mod' as it doesn't apply to resourcepacks/shaders
		if (t !== "mod") {
			setResourceStore("loader", null);
		}

		resources.fetchCategories();
	},

	fetchCategories: async () => {
		try {
			const categories = await invoke<ResourceCategory[]>(
				"get_resource_categories",
				{
					platform: resourceStore.activeSource,
				},
			);
			setResourceStore("availableCategories", categories);

			// Prune categories that no longer exist for this type
			const type = resourceStore.resourceType;
			const validIds = categories
				.filter((c) => !c.project_type || c.project_type === type)
				.map((c) => c.id);

			const current = resourceStore.categories;
			const next = current.filter((id) => validIds.includes(id));

			if (next.length !== current.length) {
				setResourceStore("categories", next);
			}
		} catch (e) {
			console.error("Failed to fetch categories", e);
		} finally {
			setResourceStore("reconcilingCategories", false);
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
			setResourceStore(
				"categories",
				current.filter((cat) => cat !== c),
			);
		} else {
			setResourceStore("categories", [...current, c]);
		}
		setResourceStore("offset", 0);
	},

	toggleCategoryGroup: (groupId: string) => {
		const current = resourceStore.expandedCategoryGroups;
		if (current.includes(groupId)) {
			setResourceStore(
				"expandedCategoryGroups",
				current.filter((id) => id !== groupId),
			);
		} else {
			setResourceStore("expandedCategoryGroups", [...current, groupId]);
		}
	},

	setExpandedCategoryGroups: (groups: string[]) => {
		setResourceStore("expandedCategoryGroups", groups);
	},
	setSortBy: (s: string) => {
		setResourceStore("sortBy", s);
		setResourceStore("offset", 0);
	},
	setSortOrder: (o: "asc" | "desc") => {
		setResourceStore("sortOrder", o);
		setResourceStore("offset", 0);
	},
	setLimit: (l: number) => {
		setResourceStore("limit", l);
		setResourceStore("offset", 0);
	},
	toggleSortOrder: () =>
		setResourceStore("sortOrder", (o) => (o === "asc" ? "desc" : "asc")),
	setViewMode: (m: "grid" | "list") => setResourceStore("viewMode", m),
	toggleFilters: () => setResourceStore("showFilters", (show) => !show),
	setOffset: (o: number) => setResourceStore("offset", o),
	setPage: (p: number) =>
		setResourceStore("offset", (p - 1) * resourceStore.limit),

	toggleSelection: (id: string) => setResourceStore("selection", id, (s) => !s),
	batchSetSelection: (selection: Record<string, boolean>) => {
		setResourceStore("selection", reconcile(selection));
	},
	clearSelection: () => setResourceStore("selection", reconcile({})),
	setSorting: (sorting: { id: string; desc: boolean }[]) =>
		setResourceStore("sorting", sorting),

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
			sortBy:
				resourceStore.activeSource === "modrinth" ? "relevance" : "featured",
			sortOrder: "desc",
		});
		resources.search();
	},

	selectProject: async (project: ResourceProject | null) => {
		setResourceStore("selectedProject", project);
		if (project) {
			setResourceStore("versionsLoading", true);
			try {
				// Fetch versions - use ignoreCache: true to ensure we get the expanded (>50) list
				// if we previously only cached 50.
				const versions = await resources.getVersions(
					project.source,
					project.id,
					true,
				);
				setResourceStore("versions", versions);
			} catch (e) {
				console.error("Failed to fetch versions:", e);
				setResourceStore("versions", []);
			} finally {
				setResourceStore("versionsLoading", false);
			}
		} else {
			setResourceStore("versions", []);
		}
	},

	search: async () => {
		const cacheKey = currentSearchCacheKey();
		setResourceStore("loading", true);
		setResourceStore("searchError", null);
		setResourceStore("searchWarning", null);
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
					categories:
						resourceStore.categories.length > 0
							? resourceStore.categories
							: null,
					sort_by: resourceStore.sortBy,
					sort_order: resourceStore.sortOrder,
				},
			});
			setResourceStore({
				results: response.hits,
				totalHits: response.total_hits,
				searchError: null,
				searchWarning: null,
			});
			if (response.hits.length > 0) {
				searchCache.set(cacheKey, {
					...response,
					source: resourceStore.activeSource,
					resourceType: resourceStore.resourceType,
				});
			}
		} catch (e) {
			console.error("Failed to search resources:", e);
			const message = e instanceof Error ? e.message : String(e);
			const cached = searchCache.get(cacheKey);
			if (cached) {
				setResourceStore({
					results: cached.hits,
					totalHits: cached.total_hits,
					searchError: null,
					searchWarning:
						"Showing cached results while the source is unavailable.",
				});
			} else {
				setResourceStore({
					results: [],
					totalHits: 0,
					searchError: message,
					searchWarning: null,
				});
			}
		} finally {
			setResourceStore("loading", false);
		}
	},

	getProject: async (platform: SourcePlatform, id: string) => {
		return await invoke<ResourceProject>("get_resource_project", {
			platform,
			id,
		});
	},

	getProjects: async (platform: SourcePlatform, ids: string[]) => {
		if (ids.length === 0) return [];
		return await invoke<ResourceProject[]>("get_resource_projects", {
			platform,
			ids,
		});
	},

	getVersions: async (
		platform: SourcePlatform,
		projectId: string,
		ignoreCache: boolean = false,
	) => {
		return await invoke<ResourceVersion[]>("get_resource_versions", {
			platform,
			projectId,
			ignoreCache,
		});
	},

	install: async (
		project: ResourceProject,
		version: ResourceVersion,
		targetInstanceId?: number | null,
	) => {
		const isModpack = project.resource_type === "modpack";
		const instanceId =
			targetInstanceId !== undefined
				? targetInstanceId
				: resourceStore.selectedInstanceId;

		if (!instanceId && !isModpack) return;

		// Immediate UI feedback
		setResourceStore("installingVersionIds", (ids) => [...ids, version.id]);
		setResourceStore("installingProjectIds", (ids) => [...ids, project.id]);

		try {
			// Cache project metadata for future offline/icon use
			await invoke("cache_resource_metadata", {
				platform: resourceStore.activeSource,
				project: project,
			});

			const result = await invoke<string>("install_resource", {
				instanceId: instanceId || 0,
				platform: project.source,
				projectId: project.id,
				projectName: project.name,
				version,
				resourceType: project.resource_type,
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
			setResourceStore("installingVersionIds", (ids) =>
				ids.filter((id) => id !== version.id),
			);
			setResourceStore("installingProjectIds", (ids) =>
				ids.filter((id) => id !== project.id),
			);
			throw e;
		}
	},

	getInstalled: async (instanceId: number) => {
		return await invoke<InstalledResource[]>("get_installed_resources", {
			instanceId,
		});
	},

	fetchInstalled: async (instanceId: number) => {
		const results = await invoke<InstalledResource[]>(
			"get_installed_resources",
			{ instanceId },
		);
		setResourceStore("installedResources", results);

		// Clear any installing IDs that are now in the results.
		// This is the source of truth for when an installation is "finished".
		const installedRemoteVersionIds = results.map((r) => r.remote_version_id);
		const installedRemoteIds = results.map((r) => r.remote_id.toLowerCase());

		setResourceStore("installingVersionIds", (ids) =>
			ids.filter((id) => !installedRemoteVersionIds.includes(id)),
		);
		setResourceStore("installingProjectIds", (ids) =>
			ids.filter((id) => !installedRemoteIds.includes(id.toLowerCase())),
		);

		return results;
	},

	sync: async (instanceId: number, instanceSlug: string, gameDir: string) => {
		return await invoke<void>("sync_instance_resources", {
			instanceId,
			instanceSlug,
			gameDir,
		});
	},

	uninstall: async (instanceId: number, resourceId: number) => {
		await invoke("delete_resource", { instanceId, resourceId });
		await resources.fetchInstalled(instanceId);
	},
};

// Listen for resource updates from the backend (watcher)
if (typeof window !== "undefined") {
	listen("resources-updated", (event) => {
		const instanceId = event.payload as number;
		if (resourceStore.selectedInstanceId === instanceId) {
			resources.fetchInstalled(instanceId);
		}
	});

	listen("resource-install-error", (event) => {
		const taskId = event.payload as string;
		// Format: download_{instance_id}_{project_id}_{version_id}
		const parts = taskId.split("_");
		if (parts.length >= 4 && parts[0] === "download") {
			const projectId = parts[2];
			const versionId = parts[3];

			setResourceStore("installingProjectIds", (ids) =>
				ids.filter((id) => id !== projectId),
			);
			setResourceStore("installingVersionIds", (ids) =>
				ids.filter((id) => id !== versionId),
			);
		}
	});
}
