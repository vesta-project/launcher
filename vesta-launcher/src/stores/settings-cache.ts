import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import {
	createEffect,
	createResource,
	createSignal,
	onCleanup,
	type Resource,
	type ResourceActions,
} from "solid-js";

export interface StorageCategorySnapshot {
	id: string;
	label: string;
	description?: string | null;
	kind: string;
	bytes: number;
	clearable: boolean;
	openable: boolean;
	governedByArtifactLimit: boolean;
}

export interface StorageInstanceSnapshot {
	id: number;
	name: string;
	slug: string;
	path: string;
	bytes: number;
}

export interface StorageSnapshot {
	totalBytes: number;
	categories: StorageCategorySnapshot[];
	instancesTotalBytes: number;
	instances: StorageInstanceSnapshot[];
	artifactCacheLimitBytes: number;
	artifactCacheUsageBytes: number;
	artifactCachePrunableBytes: number;
	artifactCachePinnedBytes: number;
	artifactCacheOverLimitBytes: number;
}

const emptyStorageSnapshot = (): StorageSnapshot => ({
	totalBytes: 0,
	categories: [],
	instancesTotalBytes: 0,
	instances: [],
	artifactCacheLimitBytes: 0,
	artifactCacheUsageBytes: 0,
	artifactCachePrunableBytes: 0,
	artifactCachePinnedBytes: 0,
	artifactCacheOverLimitBytes: 0,
});

const [settingsDataEnabled, setSettingsDataEnabled] = createSignal(false);

export function fetchStorageSnapshot(
	forceRefresh = false,
): Promise<StorageSnapshot> {
	return hasTauriRuntime()
		? invoke("get_storage_snapshot", { forceRefresh })
		: Promise.resolve(emptyStorageSnapshot());
}

// Resource for Java requirements
export const javaRequirements: [
	Resource<any[]>,
	ResourceActions<any[] | undefined>,
] = createResource<any[], boolean>(settingsDataEnabled, (enabled) =>
	enabled && hasTauriRuntime()
		? invoke("get_required_java_versions")
		: Promise.resolve([]),
);

// Auto-retry Manifest not ready
createEffect(() => {
	const [requirements, { refetch }] = javaRequirements;
	const error = requirements.error;

	if (error === "MANIFEST_NOT_READY") {
		const timer = setTimeout(() => {
			refetch();
		}, 2000);
		onCleanup(() => clearTimeout(timer));
	}
});

// Resource for detected Java versions
export const detectedJava: [
	Resource<any[]>,
	ResourceActions<any[] | undefined>,
] = createResource<any[], boolean>(settingsDataEnabled, (enabled) =>
	enabled && hasTauriRuntime() ? invoke("detect_java") : Promise.resolve([]),
);

// Resource for managed Java versions
export const managedJava: [
	Resource<any[]>,
	ResourceActions<any[] | undefined>,
] = createResource<any[], boolean>(settingsDataEnabled, (enabled) =>
	enabled && hasTauriRuntime()
		? invoke("get_managed_javas")
		: Promise.resolve([]),
);

// Resource for global Java paths
export const globalJavaPaths: [
	Resource<any[]>,
	ResourceActions<any[] | undefined>,
] = createResource<any[], boolean>(settingsDataEnabled, (enabled) =>
	enabled && hasTauriRuntime()
		? invoke("get_global_java_paths")
		: Promise.resolve([]),
);

// Resource for cache size
export const cacheSize: [
	Resource<string>,
	ResourceActions<string | undefined>,
] = createResource<string, boolean>(settingsDataEnabled, (enabled) =>
	enabled && hasTauriRuntime()
		? invoke("get_cache_size")
		: Promise.resolve("0 bytes"),
);

export const storageSnapshot: [
	Resource<StorageSnapshot>,
	ResourceActions<StorageSnapshot | undefined>,
] = createResource<StorageSnapshot, boolean>(
	settingsDataEnabled,
	(enabled) =>
		enabled
			? fetchStorageSnapshot(false)
			: Promise.resolve(emptyStorageSnapshot()),
);

// System memory
const [systemMemorySignal, setSystemMemory] = createSignal<number>(16384);

export { systemMemorySignal as systemMemory };

/**
 * Trigger pre-fetching of settings-related data.
 */
let settingsPrefetchPromise: Promise<void> | null = null;

export function prefetchSettingsData(): Promise<void> {
	if (settingsPrefetchPromise) return settingsPrefetchPromise;

	setSettingsDataEnabled(true);
	settingsPrefetchPromise = hasTauriRuntime()
		? invoke<number>("get_system_memory_mb")
				.then((ram) => {
					if (ram > 0) setSystemMemory(ram);
				})
				.catch((error) => {
					console.error("Failed to prefetch system memory:", error);
				})
		: Promise.resolve();
	return settingsPrefetchPromise;
}
