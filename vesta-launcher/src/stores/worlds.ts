import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createStore, reconcile } from "solid-js/store";

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

const inFlight = new Map<number, Promise<WorldSummary[]>>();
const subscriptions = new Map<number, Set<() => void>>();
let eventUnlisten: Promise<UnlistenFn> | null = null;

async function ensureWorldEventListener() {
	if (eventUnlisten) return eventUnlisten;
	eventUnlisten = listen<InstanceWorldsChangedEvent>(
		"core://instance-worlds-changed",
		(event) => {
			const instanceId = event.payload.instanceId;
			void listInstanceWorlds(instanceId, true).then(() => {
				for (const subscriber of subscriptions.get(instanceId) ?? []) {
					subscriber();
				}
			});
		},
	);
	return eventUnlisten;
}

export async function listInstanceWorlds(
	instanceId: number,
	forceRefresh = false,
): Promise<WorldSummary[]> {
	void ensureWorldEventListener();
	if (!forceRefresh && inFlight.has(instanceId)) {
		return inFlight.get(instanceId)!;
	}

	setWorldsState("loading", instanceId, true);
	setWorldsState("errors", instanceId, null);
	const request = invoke<WorldSummary[]>("list_instance_worlds", {
		instanceId,
		forceRefresh,
	})
		.then((worlds) => {
			setWorldsState("byInstance", instanceId, reconcile(worlds));
			return worlds;
		})
		.catch((error) => {
			setWorldsState("errors", instanceId, String(error));
			throw error;
		})
		.finally(() => {
			setWorldsState("loading", instanceId, false);
			inFlight.delete(instanceId);
		});
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

export { worldsState };
