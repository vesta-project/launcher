import { createStore, reconcile } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ACCOUNT_TYPE_GUEST } from "@utils/auth";
import { createDemoInstance, DEMO_INSTANCE_ID, type Instance } from "@utils/instances";

export type { Instance };

type InstancesState = {
	instances: Instance[];
	loading: boolean;
	error: string | null;
};

// Create store
const [instancesState, setInstancesState] = createStore<InstancesState>({
	instances: [],
	loading: false,
	error: null,
});

// Initialize instances from backend
export async function initializeInstances() {
	setInstancesState({ loading: true, error: null });
	try {
		let instances = await invoke<Instance[]>("list_instances");

		const account = await invoke<any>("get_active_account");
		if (account && account.account_type === ACCOUNT_TYPE_GUEST) {
			const virtualInstance = createDemoInstance();
			instances = [virtualInstance, ...instances];
		}

		setInstancesState({
			instances: instances,
			loading: false,
		});
	} catch (err) {
		console.error("Failed to initialize instances:", err);
		setInstancesState({
			error: err instanceof Error ? err.message : String(err),
			loading: false,
		});
	}
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

		// Listen for launch events (updates lastPlayed, playtime)
		await listen<Instance>("core://instance-launched", (event) => {
			updateInstance(event.payload);
		});

		// Listen for account changes to re-initialize instances (important for Guest -> Real transition)
		await listen<any>("config-updated", (event) => {
			if (event.payload.field === "active_account_uuid") {
				console.log(
					"[InstancesStore] Active account changed, re-initializing...",
				);
				initializeInstances();
			}
		});

		await listen<any>("core://account-heads-updated", () => {
			console.log("[InstancesStore] Account heads updated, re-initializing...");
			initializeInstances();
		});
	})();

	return setupPromise;
}

// Export read-only accessor
export const instances = () => instancesState.instances;
export const instancesLoading = () => instancesState.loading;
export const instancesError = () => instancesState.error;

// Export state for debugging
export { instancesState };
