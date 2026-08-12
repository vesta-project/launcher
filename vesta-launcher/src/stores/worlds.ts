import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createStore, reconcile } from "solid-js/store";
import type { ResourceVersion } from "./resources";

export type WorldRef = {
	instanceId: number;
	directoryName: string;
};

export type ResourceInstallTarget =
	| { kind: "instance"; instanceId: number }
	| { kind: "world"; world: WorldRef };

export type WorldStorageFamily = "alpha" | "mcregion" | "anvil" | "unknown";
export type WorldLevelStatus = "valid" | "recovered" | "unreadable";
export type WorldMetadataStatus = "absent" | "valid" | "corrupt" | "future";

export type WorldSummary = {
	ref: WorldRef;
	worldId: string | null;
	instanceName: string;
	folderName: string;
	displayName: string;
	lastPlayedAt: string | null;
	sizeBytes: number;
	iconDataUrl: string | null;
	dataVersion: number | null;
	gameVersion: string | null;
	storageFamily: WorldStorageFamily;
	levelStatus: WorldLevelStatus;
	metadataStatus: WorldMetadataStatus;
	datapackCount: number;
	managedDatapackCount: number;
	running: boolean;
};

export type WorldTransferMode = "move" | "copy" | "duplicate";

export type WorldTransferRisk = {
	requiresAcknowledgement: boolean;
	reasons: string[];
};

export type WorldCandidate = {
	id: string;
	name: string;
	folder: string;
	sizeBytes: number;
	iconDataUrl: string | null;
	dataVersion: number | null;
	gameVersion: string | null;
};

export type WorldArchiveSelectionRequest = {
	installId: string;
	project: {
		name: string;
		iconUrl?: string | null;
	} | null;
	candidates: WorldCandidate[];
	expiresAt: string;
};

export type InstanceWorldsChangedEvent = {
	instanceId: number;
	revision: number;
	reason: string;
};

export type WorldDatapackEntryKind = "file" | "directory";

export type WorldDatapackSummary = {
	resourceId: number | null;
	fileName: string;
	displayName: string;
	entryKind: WorldDatapackEntryKind;
	platform: string | null;
	projectId: string | null;
	versionId: string | null;
	versionNumber: string | null;
	enabled: boolean;
	managed: boolean;
	readOnly: boolean;
	sizeBytes: number;
	modifiedAt: string | null;
};

export type WorldDatapackOverview = {
	world: WorldRef;
	entries: WorldDatapackSummary[];
};

export type WorldDatapacksChangedEvent = {
	world: WorldRef;
	revision: number;
	reason: string;
};

export type WorldDatapackUpdateStatus = {
	resourceId: number;
	exactVersion: ResourceVersion | null;
	manualReviewAvailable: boolean;
	error: string | null;
};

export type WorldDatapackUpdateCheck = {
	world: WorldRef;
	gameVersion: string | null;
	updates: WorldDatapackUpdateStatus[];
};

export type WorldDatapackRemoval = {
	removedCompanionCount: number;
	retainedCompanionCount: number;
	cleanupWarning: string | null;
};

type WorldsState = {
	byInstance: Record<number, WorldSummary[]>;
	loading: Record<number, boolean>;
	errors: Record<number, string | null>;
};

const [worldsState, setWorldsState] = createStore<WorldsState>({
	byInstance: {},
	loading: {},
	errors: {},
});

type WorldDatapacksState = {
	byWorld: Record<string, WorldDatapackOverview | undefined>;
	updatesByWorld: Record<string, WorldDatapackUpdateCheck | undefined>;
	loading: Record<string, boolean>;
	updatesLoading: Record<string, boolean>;
	errors: Record<string, string | null>;
	updateErrors: Record<string, string | null>;
};

const [worldDatapacksState, setWorldDatapacksState] =
	createStore<WorldDatapacksState>({
		byWorld: {},
		updatesByWorld: {},
		loading: {},
		updatesLoading: {},
		errors: {},
		updateErrors: {},
	});

const inFlight = new Map<number, Promise<WorldSummary[]>>();
const worldRequestGenerations = new Map<number, number>();
const subscriptions = new Map<number, Set<() => void>>();
let eventUnlisten: Promise<UnlistenFn> | null = null;
const datapackInFlight = new Map<string, Promise<WorldDatapackOverview>>();
const datapackRequestGenerations = new Map<string, number>();
const datapackUpdatesInFlight = new Map<
	string,
	Promise<WorldDatapackUpdateCheck>
>();
const datapackUpdateRequestGenerations = new Map<string, number>();
let datapackEventUnlisten: Promise<UnlistenFn> | null = null;

export function worldRefKey(world: WorldRef): string {
	return `${world.instanceId}:${world.directoryName}`;
}

async function ensureWorldEventListener() {
	if (eventUnlisten) return eventUnlisten;
	eventUnlisten = listen<InstanceWorldsChangedEvent>(
		"core://instance-worlds-changed",
		(event) => {
			const instanceId = event.payload.instanceId;
			void (async () => {
				try {
					await listInstanceWorlds(instanceId, true);
					for (const subscriber of subscriptions.get(instanceId) ?? []) {
						subscriber();
					}
				} catch {
					// Store state already carries the scoped refresh error.
				}
			})();
		},
	);
	return eventUnlisten;
}

async function ensureWorldDatapackEventListener() {
	if (datapackEventUnlisten) return datapackEventUnlisten;
	datapackEventUnlisten = listen<WorldDatapacksChangedEvent>(
		"core://world-datapacks-changed",
		(event) => {
			const key = worldRefKey(event.payload.world);
			if (worldDatapacksState.byWorld[key]) {
				void listWorldDatapacks(event.payload.world, true).catch(
					() => undefined,
				);
			}
			if (worldDatapacksState.updatesByWorld[key]) {
				void checkWorldDatapackUpdates(event.payload.world, true).catch(
					() => undefined,
				);
			}
		},
	);
	return datapackEventUnlisten;
}

export function listInstanceWorlds(
	instanceId: number,
	forceRefresh = false,
): Promise<WorldSummary[]> {
	void ensureWorldEventListener();
	if (!forceRefresh && inFlight.has(instanceId)) {
		return inFlight.get(instanceId)!;
	}

	setWorldsState("loading", instanceId, true);
	setWorldsState("errors", instanceId, null);
	const generation = (worldRequestGenerations.get(instanceId) ?? 0) + 1;
	worldRequestGenerations.set(instanceId, generation);
	const request = invoke<WorldSummary[]>("list_instance_worlds", {
		instanceId,
		forceRefresh,
	})
		.then((worlds) => {
			if (worldRequestGenerations.get(instanceId) === generation) {
				setWorldsState("byInstance", instanceId, reconcile(worlds));
			}
			return worlds;
		})
		.catch((error) => {
			if (worldRequestGenerations.get(instanceId) === generation) {
				setWorldsState("errors", instanceId, String(error));
			}
			throw error;
		})
		.finally(() => {
			if (worldRequestGenerations.get(instanceId) === generation) {
				setWorldsState("loading", instanceId, false);
			}
			if (inFlight.get(instanceId) === request) inFlight.delete(instanceId);
		});
	void request.catch(() => undefined);
	inFlight.set(instanceId, request);
	return request;
}

export function subscribeToInstanceWorlds(
	instanceId: number,
	subscriber: () => void,
): () => void {
	void ensureWorldEventListener();
	const current = subscriptions.get(instanceId) ?? new Set();
	current.add(subscriber);
	subscriptions.set(instanceId, current);
	return () => {
		current.delete(subscriber);
		if (current.size === 0) subscriptions.delete(instanceId);
	};
}

export function openWorldFolder(world: WorldRef): Promise<void> {
	return invoke("open_world_folder", { worldRef: world });
}

export function listWorldDatapacks(
	world: WorldRef,
	forceRefresh = false,
): Promise<WorldDatapackOverview> {
	void ensureWorldDatapackEventListener();
	const key = worldRefKey(world);
	if (!forceRefresh && datapackInFlight.has(key)) {
		return datapackInFlight.get(key)!;
	}

	setWorldDatapacksState("loading", key, true);
	setWorldDatapacksState("errors", key, null);
	const generation = (datapackRequestGenerations.get(key) ?? 0) + 1;
	datapackRequestGenerations.set(key, generation);
	const request = invoke<WorldDatapackOverview>("list_world_datapacks", {
		worldRef: world,
	})
		.then((overview) => {
			if (datapackRequestGenerations.get(key) === generation) {
				setWorldDatapacksState("byWorld", key, reconcile(overview));
			}
			return overview;
		})
		.catch((error) => {
			if (datapackRequestGenerations.get(key) === generation) {
				setWorldDatapacksState("errors", key, String(error));
			}
			throw error;
		})
		.finally(() => {
			if (datapackRequestGenerations.get(key) === generation) {
				setWorldDatapacksState("loading", key, false);
			}
			if (datapackInFlight.get(key) === request) datapackInFlight.delete(key);
		});
	void request.catch(() => undefined);
	datapackInFlight.set(key, request);
	return request;
}

export function checkWorldDatapackUpdates(
	world: WorldRef,
	forceRefresh = false,
): Promise<WorldDatapackUpdateCheck> {
	void ensureWorldDatapackEventListener();
	const key = worldRefKey(world);
	if (!forceRefresh && datapackUpdatesInFlight.has(key)) {
		return datapackUpdatesInFlight.get(key)!;
	}

	setWorldDatapacksState("updatesLoading", key, true);
	setWorldDatapacksState("updateErrors", key, null);
	const generation = (datapackUpdateRequestGenerations.get(key) ?? 0) + 1;
	datapackUpdateRequestGenerations.set(key, generation);
	const request = invoke<WorldDatapackUpdateCheck>(
		"check_world_datapack_updates",
		{ worldRef: world, forceRefresh },
	)
		.then((result) => {
			if (datapackUpdateRequestGenerations.get(key) === generation) {
				setWorldDatapacksState("updatesByWorld", key, reconcile(result));
			}
			return result;
		})
		.catch((error) => {
			if (datapackUpdateRequestGenerations.get(key) === generation) {
				setWorldDatapacksState("updateErrors", key, String(error));
			}
			throw error;
		})
		.finally(() => {
			if (datapackUpdateRequestGenerations.get(key) === generation) {
				setWorldDatapacksState("updatesLoading", key, false);
			}
			if (datapackUpdatesInFlight.get(key) === request) {
				datapackUpdatesInFlight.delete(key);
			}
		});
	void request.catch(() => undefined);
	datapackUpdatesInFlight.set(key, request);
	return request;
}

export async function toggleWorldDatapack(
	world: WorldRef,
	resourceId: number,
	enabled: boolean,
): Promise<void> {
	await invoke("toggle_world_datapack", {
		worldRef: world,
		resourceId,
		enabled,
	});
}

export async function deleteWorldDatapack(
	world: WorldRef,
	resourceId: number,
): Promise<WorldDatapackRemoval> {
	return invoke("delete_world_datapack", { worldRef: world, resourceId });
}

export function openWorldDatapacksFolder(world: WorldRef): Promise<void> {
	return invoke("open_world_datapacks_folder", { worldRef: world });
}

export function transferWorld(
	world: WorldRef,
	destinationInstanceId: number,
	mode: WorldTransferMode,
	riskAcknowledged: boolean,
): Promise<string> {
	return invoke("transfer_world", {
		worldRef: world,
		destinationInstanceId,
		mode,
		riskAcknowledged,
	});
}

export function submitWorldArchiveSelection(
	installId: string,
	selectedCandidateIds: string[],
): Promise<void> {
	return invoke("submit_world_archive_selection", {
		installId,
		selectedCandidateIds,
	});
}

export { worldDatapacksState, worldsState };
