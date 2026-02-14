import { createStore, reconcile } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ACCOUNT_TYPE_GUEST } from "@utils/auth";
import {
	createDemoInstance,
	DEMO_INSTANCE_ID,
	type Instance,
} from "@utils/instances";

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
	error: string | null;
};

// Create store
const [instancesState, setInstancesState] = createStore<InstancesState>({
	instances: [],
	launchingIds: {},
	runningIds: {},
	loading: false,
	error: null,
});

export function setLaunching(slug: string, launching: boolean) {
	setInstancesState("launchingIds", (prev) => ({ ...prev, [slug]: launching }));
}

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

		// Listen for launch initiated (this is for UI responsiveness)
		await listen<{ instance_id: string }>("core://instance-launch-request", (event) => {
			setLaunching(event.payload.instance_id, true);
		});

		// Listen for launch events (updates when process successfully started)
		await listen<{ instance_id: string; pid: number; start_time?: number }>("core://instance-launched", (event) => {
			const slug = event.payload.instance_id;
			setLaunching(slug, false);
			setInstancesState("runningIds", slug, {
				pid: event.payload.pid,
				startTime: event.payload.start_time || Math.floor(Date.now() / 1000),
			});
		});

		// Listen for instance exit/crash
		await listen<{ instance_id: string; crashed: boolean }>("core://instance-exited", (event) => {
			const slug = event.payload.instance_id;
			setLaunching(slug, false);
			setInstancesState("runningIds", slug, undefined);
			
			// Refresh instance metadata if crashed/playtime updated
			initializeInstances();
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
