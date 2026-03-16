import { createEffect, createResource, createSignal, onCleanup, type Resource, type ResourceActions } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "@utils/tauri-runtime";

// Resource for Java requirements
export const javaRequirements: [Resource<any[]>, ResourceActions<any[] | undefined>] = createResource<any[]>(() =>
	hasTauriRuntime() ? invoke("get_required_java_versions") : Promise.resolve([]),
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
export const detectedJava: [Resource<any[]>, ResourceActions<any[] | undefined>] = createResource<any[]>(() =>
	hasTauriRuntime() ? invoke("detect_java") : Promise.resolve([]),
);

// Resource for managed Java versions
export const managedJava: [Resource<any[]>, ResourceActions<any[] | undefined>] = createResource<any[]>(() =>
	hasTauriRuntime() ? invoke("get_managed_javas") : Promise.resolve([]),
);

// Resource for global Java paths
export const globalJavaPaths: [Resource<any[]>, ResourceActions<any[] | undefined>] = createResource<any[]>(() =>
	hasTauriRuntime() ? invoke("get_global_java_paths") : Promise.resolve([]),
);

// Resource for cache size
export const cacheSize: [Resource<string>, ResourceActions<string | undefined>] = createResource<string>(() =>
	hasTauriRuntime() ? invoke("get_cache_size") : Promise.resolve("0 bytes"),
);

// Extract refetchers for easy use in prefetchSettingsData
const [, { refetch: refetchReqs }] = javaRequirements;
const [, { refetch: refetchDet }] = detectedJava;
const [, { refetch: refetchMan }] = managedJava;
const [, { refetch: refetchGlob }] = globalJavaPaths;
const [, { refetch: refetchSize }] = cacheSize;

// System memory
const [systemMemorySignal, setSystemMemory] = createSignal<number>(16384);
export { systemMemorySignal as systemMemory };

/**
 * Trigger pre-fetching of settings-related data.
 */
export async function prefetchSettingsData() {
	// Trigger resources via refetch to ensure they run
	refetchReqs();
	refetchDet();
	refetchMan();
	refetchGlob();
	refetchSize();

	// Prefetch system memory
	if (hasTauriRuntime()) {
		try {
			const ram = await invoke<number>("get_system_memory_mb");
			if (typeof ram === "number" && ram > 0) setSystemMemory(ram);
		} catch (e) {
			console.error("Failed to prefetch system memory:", e);
		}
	}
}
