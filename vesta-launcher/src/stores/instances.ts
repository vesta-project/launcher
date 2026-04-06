import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ACCOUNT_TYPE_GUEST } from "@utils/auth";
import {
	createDemoInstance,
	type Instance
} from "@utils/instances";
import { createStore, reconcile } from "solid-js/store";

export type { Instance };

type RunningMetadata = {
	pid: number;
	startTime: number;
};

type InstancesState = {
	instances: Instance[];
	launchingIds: Record<string, boolean>;
	runningIds: Record<string, RunningMetadata>;
	loading: boolean;
	initialized: boolean;
	error: string | null;
};

// Create store
const [instancesState, setInstancesState] = createStore<InstancesState>({
	instances: [],
	launchingIds: {},
	runningIds: {},
	loading: false,
	initialized: false,
	error: null,
});

let initializePromise: Promise<void> | null = null;

export function setLaunching(slug: string, launching: boolean) {
	setInstancesState("launchingIds", (prev) => ({ ...prev, [slug]: launching }));
}

/**
 * Initialize instance store from backend.
 *
 * Idempotency rules:
 * - If an initialization is already in-flight, callers join that promise.
 * - If store is already initialized and `force` is false, this is a no-op and
 *   returns `Promise.resolve()` without creating a new in-flight promise.
 * - When `force` is true, a refresh is executed even after prior initialization.
 */
export function initializeInstances(force = false): Promise<void> {
	if (initializePromise) {
		return initializePromise;
	}

	if (instancesState.initialized && !force) {
		return Promise.resolve();
	}

	initializePromise = (async () => {
		setInstancesState({ loading: true, error: null });
		try {
			const [fetchedInstances, account] = await Promise.all([
				invoke<Instance[]>("list_instances"),
				invoke<any>("get_active_account"),
			]);

			let instances = fetchedInstances;
			if (account && account.account_type === ACCOUNT_TYPE_GUEST) {
				const virtualInstance = createDemoInstance();
				instances = [virtualInstance, ...instances];
			}

			setInstancesState({
				instances,
				loading: false,
				initialized: true,
				error: null,
			});
		} catch (err) {
			console.error("Failed to initialize instances:", err);
			setInstancesState({
				error: err instanceof Error ? err.message : String(err),
				loading: false,
				initialized: false,
			});
		}
	})().finally(() => {
		initializePromise = null;
	});

	return initializePromise;
}

// Update single instance in store
function updateInstance(updatedInstance: Instance) {
	setInstancesState(
		"instances",
		(inst) => inst.id === updatedInstance.id,
		reconcile(updatedInstance),
	);
}

// Add new instance to store
function addInstance(newInstance: Instance) {
	setInstancesState("instances", (instances) => [...instances, newInstance]);
}

// Remove instance from store
function removeInstance(instanceId: number) {
	setInstancesState("instances", (instances) =>
		instances.filter((inst) => inst.id !== instanceId),
	);
}

// Listen for Tauri events
let setupPromise: Promise<void> | null = null;

export function setupInstanceListeners() {
	if (setupPromise) return setupPromise;

	setupPromise = (async () => {
		// Listen for instance updates
		await listen<Instance>("core://instance-updated", (event) => {
			updateInstance(event.payload);
		});

		// Listen for instance creation
		await listen<Instance>("core://instance-created", (event) => {
			addInstance(event.payload);
		});

		// Listen for instance deletion
		await listen<{ id: number }>("core://instance-deleted", (event) => {
			removeInstance(event.payload.id);
		});

		// Listen for installation status updates
		await listen<Instance>("core://instance-installed", (event) => {
			updateInstance(event.payload);
		});

		// Listen for launch initiated (this is for UI responsiveness)
		await listen<{ instance_id: string }>(
			"core://instance-launch-request",
			(event) => {
				setLaunching(event.payload.instance_id, true);
			},
		);

		// Listen for launch events (updates when process successfully started)
		await listen<{ instance_id: string; pid: number; start_time?: number }>(
			"core://instance-launched",
			(event) => {
				const slug = event.payload.instance_id;
				setLaunching(slug, false);
				setInstancesState("runningIds", slug, {
					pid: event.payload.pid,
					startTime: event.payload.start_time || Math.floor(Date.now() / 1000),
				});
			},
		);

		// Listen for instance exit/crash
		await listen<{ instance_id: string; crashed: boolean }>(
			"core://instance-exited",
			(event) => {
				const slug = event.payload.instance_id;
				setLaunching(slug, false);
				setInstancesState("runningIds", (prev) => {
					const { [slug]: _removed, ...next } = prev;
					return next;
				});

				// Refresh instance metadata if crashed/playtime updated
				void initializeInstances(true).catch((error) => {
					console.error("Failed to refresh instances after exit:", error);
				});
			},
		);

		// Listen for account changes to re-initialize instances (important for Guest -> Real transition)
		await listen<any>("config-updated", (event) => {
			if (event.payload.field === "active_account_uuid") {
				console.log(
					"[InstancesStore] Active account changed, re-initializing...",
				);
				void initializeInstances(true).catch((error) => {
					console.error(
						"Failed to refresh instances after account change:",
						error,
					);
				});
			}
		});

		await listen<any>("core://account-heads-updated", () => {
			console.log("[InstancesStore] Account heads updated, re-initializing...");
			void initializeInstances(true).catch((error) => {
				console.error("Failed to refresh instances after head update:", error);
			});
		});
	})();

	return setupPromise;
}

// Export read-only accessor
export const instances = () => instancesState.instances;
export const instancesLoading = () => instancesState.loading;
export const instancesInitialized = () => instancesState.initialized;
export const instancesError = () => instancesState.error;

// Export state for debugging
export { instancesState };
