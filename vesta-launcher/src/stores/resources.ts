import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProgressUpdate } from "@utils/notifications";
import type { ResourceInstallRequest } from "@utils/resource-install-intent";
import {
	firstSourceForResourceType,
	getSourceDescriptor,
} from "@resources/source-catalog";
import { createStore, reconcile } from "solid-js/store";
import { parseDownloadTaskId } from "@utils/resource-task-id";
import { refreshInstanceResourceRows } from "./instance-resource-overview";
import { Instance } from "./instances";
import type { ResourceInstallTarget } from "./worlds";

export type ResourceType =
	| "mod"
	| "resourcepack"
	| "shader"
	| "datapack"
	| "modpack"
	| "world";
export type SourcePlatform = "modrinth" | "curseforge" | "smithed";

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

export type ResourceVersionFile = {
	url: string;
	file_name: string;
	hash?: string;
	file_size?: number | null;
	role: string;
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
	published_at?: string | null;
	download_count?: number | null;
	file_size?: number | null;
	files?: ResourceVersionFile[];
};

export type ResourceVersionDetails = {
	version: ResourceVersion;
	changelog: string | null;
	changelog_format: "markdown" | "html";
	changelog_status: "available" | "empty" | "unavailable";
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

export type ResourceRescanSummary = {
	scanned: number;
	hashed: number;
	identified: number;
	unresolved: number;
	status: "complete" | "partial" | "offline" | "alreadyRunning";
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
	installingTargetKeys: string[];
	selection: Record<string, boolean>;
	sorting: { id: string; desc: boolean }[];
	/** Remote image URL → base64 data URL from `resolve_image_urls`. */
	resolvedBrowseImages: Record<string, string>;
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
	installingTargetKeys: [],
	selection: {},
	sorting: [{ id: "display_name", desc: false }],
	resolvedBrowseImages: {},
});

const searchCache = new Map<string, CachedSearchResponse>();
const versionDetailsCache = new Map<string, ResourceVersionDetails>();

function clearInstallingMatchedByInstalled(results: InstalledResource[]) {
	const installed = new Set(
		results.map(
			(resource) =>
				`${resource.platform.toLowerCase()}:${resource.remote_id.toLowerCase()}:${resource.remote_version_id}`,
		),
	);

	setResourceStore("installingTargetKeys", (keys) =>
		keys.filter((key) => {
			const [source, projectId, versionId] = key.split(":");
			if (!source || !projectId || !versionId) return true;
			return !installed.has(
				`${source.toLowerCase()}:${projectId.toLowerCase()}:${versionId}`,
			);
		}),
	);

	const remaining = resourceStore.installingTargetKeys;
	setResourceStore("installingProjectIds", (ids) =>
		ids.filter((id) =>
			remaining.some((key) => {
				const parts = key.split(":");
				return parts[1] === id;
			}),
		),
	);
	setResourceStore("installingVersionIds", (ids) =>
		ids.filter((id) =>
			remaining.some((key) => {
				const parts = key.split(":");
				return parts[1] && parts[2] === id;
			}),
		),
	);
}

function clearInstallingFromTaskId(taskId: string) {
	const parsed = parseDownloadTaskId(taskId);
	if (!parsed) return;

	setResourceStore("installingProjectIds", (ids) =>
		ids.filter((id) => id !== parsed.projectId),
	);
	setResourceStore("installingVersionIds", (ids) =>
		ids.filter((id) => id !== parsed.versionId),
	);
	setResourceStore("installingTargetKeys", (keys) =>
		keys.filter((key) => {
			const parts = key.split(":");
			return !(
				parts[1] === parsed.projectId && parts[2] === parsed.versionId
			);
		}),
	);
}

function bannerUrlForProject(project: ResourceProject): string | null {
	if (project.gallery.length > 0) return project.gallery[0];
	return project.featured_gallery ?? null;
}

const MAX_RESOLVED_BROWSE_IMAGES = 64;
let browseWarmGeneration = 0;

function pruneResolvedBrowseImages(keepUrls: string[]) {
	const keep = new Set(keepUrls);
	const next: Record<string, string> = {};
	for (const url of keep) {
		const dataUrl = resourceStore.resolvedBrowseImages[url];
		if (dataUrl) next[url] = dataUrl;
	}
	const keys = Object.keys(next);
	if (keys.length > MAX_RESOLVED_BROWSE_IMAGES) {
		for (const extra of keys.slice(
			0,
			keys.length - MAX_RESOLVED_BROWSE_IMAGES,
		)) {
			delete next[extra];
		}
	}
	setResourceStore("resolvedBrowseImages", reconcile(next));
}

/** Warm Rust image cache for browse banners; mirrors into `resolvedBrowseImages`. */
async function warmBrowseBannerImages(hits: ResourceProject[]) {
	const hitUrls = [
		...new Set(
			hits
				.map(bannerUrlForProject)
				.filter((url): url is string => Boolean(url)),
		),
	];
	pruneResolvedBrowseImages(hitUrls);

	const urls = hitUrls.filter(
		(url) =>
			!resourceStore.resolvedBrowseImages[url] &&
			// Firebase CDN banners load in the webview; skip Rust warm for them.
			!url.includes("firebasestorage.googleapis.com"),
	);
	if (urls.length === 0) return;

	const token = ++browseWarmGeneration;
	try {
		const resolved = await invoke<string[]>("resolve_image_urls", { urls });
		if (token !== browseWarmGeneration) return;
		for (let i = 0; i < urls.length; i++) {
			const dataUrl = resolved[i];
			if (dataUrl) {
				setResourceStore("resolvedBrowseImages", urls[i], dataUrl);
			}
		}
		pruneResolvedBrowseImages(hitUrls);
	} catch (e) {
		console.error("Failed to warm browse banner images:", e);
	}
}

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

	resolvedBrowseImage: (url: string | null | undefined) =>
		url ? (resourceStore.resolvedBrowseImages[url] ?? null) : null,

	setInstallRequest: (request: ResourceInstallRequest | null) =>
		setResourceStore("installRequest", request),

	setQuery: (q: string) => setResourceStore("query", q),
	setSource: (s: SourcePlatform) => {
		const descriptor = getSourceDescriptor(s);
		setResourceStore("reconcilingCategories", true);
		setResourceStore("activeSource", s);
		setResourceStore("availableCategories", []);
		setResourceStore("sortBy", descriptor?.defaultSort ?? "relevance");
		setResourceStore("categories", []);
		setResourceStore("offset", 0);

		if (
			descriptor &&
			!descriptor.supportedResourceTypes.includes(resourceStore.resourceType)
		) {
			setResourceStore(
				"resourceType",
				descriptor.supportedResourceTypes[0] ?? "mod",
			);
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

		const active = getSourceDescriptor(resourceStore.activeSource);
		if (active && !active.supportedResourceTypes.includes(t)) {
			const fallback = firstSourceForResourceType(t);
			setResourceStore("activeSource", fallback.id);
			setResourceStore("sortBy", fallback.defaultSort);
			setResourceStore("categories", []);
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
				getSourceDescriptor(resourceStore.activeSource)?.defaultSort ??
				"relevance",
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
		const cached = searchCache.get(cacheKey);
		if (cached) {
			setResourceStore({
				results: cached.hits,
				totalHits: cached.total_hits,
				loading: false,
			});
			void warmBrowseBannerImages(cached.hits);
		} else {
			setResourceStore("loading", true);
		}
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
			searchCache.set(cacheKey, {
				...response,
				source: resourceStore.activeSource,
				resourceType: resourceStore.resourceType,
			});
			void warmBrowseBannerImages(response.hits);
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
				void warmBrowseBannerImages(cached.hits);
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

	getVersionDetails: async (
		platform: SourcePlatform,
		projectId: string,
		versionId: string,
		ignoreCache: boolean = false,
	) => {
		const cacheKey = `${platform}:${projectId}:${versionId}`;
		if (!ignoreCache) {
			const cached = versionDetailsCache.get(cacheKey);
			if (cached) return cached;
		}

		const details = await invoke<ResourceVersionDetails>(
			"get_resource_version_details",
			{
				platform,
				projectId,
				versionId,
			},
		);
		if (details.changelog_status !== "unavailable") {
			versionDetailsCache.set(cacheKey, details);
		}
		return details;
	},

	install: async (
		project: ResourceProject,
		version: ResourceVersion,
		target?: ResourceInstallTarget | null,
		options?: {
			installType?: ResourceType;
			compatibilityAcknowledged?: boolean;
			replacementResourceId?: number;
		},
	) => {
		const installType = options?.installType ?? project.resource_type;
		const isModpack = installType === "modpack";
		const resolvedTarget =
			target ??
			(resourceStore.selectedInstanceId
				? {
						kind: "instance" as const,
						instanceId: resourceStore.selectedInstanceId,
					}
				: null);

		if (!resolvedTarget && !isModpack) return;

		// Immediate UI feedback
		setResourceStore("installingVersionIds", (ids) => [...ids, version.id]);
		setResourceStore("installingProjectIds", (ids) => [...ids, project.id]);
		const targetKey = resolvedTarget
			? resolvedTarget.kind === "world"
				? `${project.source}:${project.id}:${version.id}:world:${resolvedTarget.world.instanceId}:${resolvedTarget.world.directoryName}`
				: `${project.source}:${project.id}:${version.id}:instance:${resolvedTarget.instanceId}`
			: `${project.source}:${project.id}:${version.id}:modpack`;
		setResourceStore("installingTargetKeys", (keys) => [...keys, targetKey]);

		try {
			// Cache project metadata for future offline/icon use
			await invoke("cache_resource_metadata", {
				platform: project.source,
				project: project,
			});

			const result = await invoke<string>("install_resource", {
				target: resolvedTarget ?? { kind: "instance", instanceId: 0 },
				platform: project.source,
				projectId: project.id,
				projectName: project.name,
				version,
				installType,
				compatibilityAcknowledged: options?.compatibilityAcknowledged ?? false,
				replacementResourceId: options?.replacementResourceId ?? null,
			});

			// Installing IDs are cleared by the scoped rows event after the
			// Resource Watcher atomically publishes the completed local batch.

			return result;
		} catch (e) {
			// Remove from installing list ONLY on error
			setResourceStore("installingVersionIds", (ids) =>
				ids.filter((id) => id !== version.id),
			);
			setResourceStore("installingProjectIds", (ids) =>
				ids.filter((id) => id !== project.id),
			);
			setResourceStore("installingTargetKeys", (keys) =>
				keys.filter((key) => key !== targetKey),
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
		clearInstallingMatchedByInstalled(results);

		return results;
	},

	rescan: async (
		instanceId: number,
		resourceIds?: number[],
		onProgress?: (update: ProgressUpdate) => void,
	) => {
		const progressChannel = new Channel<ProgressUpdate>();
		progressChannel.onmessage = (update) => onProgress?.(update);
		return await invoke<ResourceRescanSummary>("rescan_instance_resources", {
			instanceId,
			resourceIds,
			progressChannel,
		});
	},

	uninstall: async (instanceId: number, resourceId: number) => {
		await invoke("delete_resource", { instanceId, resourceId });
		await resources.fetchInstalled(instanceId);
	},
};

let defaultBrowsePreload: Promise<void> | undefined;

/**
 * Populate this webview's browse store while it is still hidden. The Rust
 * resource manager provides the cross-webview cache; this layer retains the
 * response so later refreshes can render stale data while revalidating.
 */
export function preloadDefaultBrowseData(): Promise<void> {
	if (!defaultBrowsePreload) {
		defaultBrowsePreload = Promise.all([
			resources.fetchCategories(),
			resources.search(),
		]).then(() => undefined);
	}
	return defaultBrowsePreload;
}

// Listen for resource updates from the backend (watcher)
if (typeof window !== "undefined") {
	listen<{ world: import("@stores/worlds").WorldRef }>(
		"core://world-datapacks-changed",
		(event) => {
			const suffix = `:world:${event.payload.world.instanceId}:${event.payload.world.directoryName}`;
			const completed = resourceStore.installingTargetKeys.filter((key) =>
				key.endsWith(suffix),
			);
			if (completed.length === 0) return;
			setResourceStore("installingTargetKeys", (keys) =>
				keys.filter((key) => !key.endsWith(suffix)),
			);
			for (const key of completed) {
				const [, projectId, versionId] = key.split(":");
				if (
					!resourceStore.installingTargetKeys.some((candidate) =>
						candidate.includes(`:${projectId}:`),
					)
				) {
					setResourceStore("installingProjectIds", (ids) =>
						ids.filter((id) => id !== projectId),
					);
				}
				if (
					!resourceStore.installingTargetKeys.some((candidate) =>
						candidate.includes(`:${projectId}:${versionId}:`),
					)
				) {
					setResourceStore("installingVersionIds", (ids) =>
						ids.filter((id) => id !== versionId),
					);
				}
			}
		},
	);

	listen<{ instanceId: number; revision: string }>(
		"core://instance-resource-rows-changed",
		(event) => {
			const instanceId = event.payload.instanceId;
			if (resourceStore.selectedInstanceId === instanceId) {
				void refreshInstanceResourceRows(
					instanceId,
					event.payload.revision,
				).then((results) => {
					setResourceStore("installedResources", results);
					clearInstallingMatchedByInstalled(results);
				});
			}
		},
	);

	listen("resource-install-error", (event) => {
		const taskId = event.payload as string;
		if (
			typeof taskId === "string" &&
			(taskId.startsWith("download_") || taskId.startsWith("download|"))
		) {
			clearInstallingFromTaskId(taskId);
		}
	});
}
