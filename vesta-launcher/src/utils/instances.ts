import PlaceholderImage1 from "@assets/placeholder-images/placeholder-image1.png";
import PlaceholderImage2 from "@assets/placeholder-images/placeholder-image2.png";
import PlaceholderImage3 from "@assets/placeholder-images/placeholder-image3.png";
import PlaceholderImage4 from "@assets/placeholder-images/placeholder-image4.png";
import PlaceholderImage5 from "@assets/placeholder-images/placeholder-image5.png";
import PlaceholderImage6 from "@assets/placeholder-images/placeholder-image6.png";
import PlaceholderImage7 from "@assets/placeholder-images/placeholder-image7.png";
import PlaceholderImage8 from "@assets/placeholder-images/placeholder-image8.png";
import PlaceholderImage9 from "@assets/placeholder-images/placeholder-image9.png";
import PlaceholderImage10 from "@assets/placeholder-images/placeholder-image10.png";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Default icons for instances
export const DEFAULT_ICONS = [
	PlaceholderImage1,
	PlaceholderImage2,
	PlaceholderImage3,
	PlaceholderImage4,
	PlaceholderImage5,
	PlaceholderImage6,
	PlaceholderImage7,
	PlaceholderImage8,
	PlaceholderImage9,
	PlaceholderImage10,
	// "linear-gradient(135deg, #FF6B6B 0%, #EE5D5D 100%)",
	// "linear-gradient(135deg, #4FACFE 0%, #00F2FE 100%)",
	// "linear-gradient(135deg, #43E97B 0%, #38F9D7 100%)",
	// "linear-gradient(135deg, #FA709A 0%, #FEE140 100%)",
	// "linear-gradient(135deg, #667EEA 0%, #764BA2 100%)",
	// "linear-gradient(135deg, #F6D365 0%, #FDA085 100%)",
	// "linear-gradient(135deg, #B721FF 0%, #21D4FD 100%)",
	// "linear-gradient(135deg, #0BA360 0%, #3CBA92 100%)",
];

// Instance type matching Rust struct
export interface Instance {
	id: number;
	name: string;
	minecraftVersion: string;
	modloader: string | null;
	modloaderVersion: string | null;
	javaPath: string | null;
	javaArgs: string | null;
	gameDirectory: string | null;
	width: number;
	height: number;
	minMemory: number;
	maxMemory: number;
	iconPath: string | null;
	lastPlayed: string | null;
	totalPlaytimeMinutes: number;
	createdAt: string | null;
	updatedAt: string | null;
	// Installation status: optional field for frontend UI to know whether instance is installed/installed/failed
	installationStatus?:
		| "pending"
		| "installing"
		| "installed"
		| "failed"
		| null;
	crashed?: boolean;
	crashDetails?: string | null;
	modpackId: string | null;
	modpackVersionId: string | null;
	modpackPlatform: string | null;
	modpackIconUrl: string | null;
	iconData: Uint8Array | null;
}

// Simplified version for creating new instances
export interface CreateInstanceData {
	name: string;
	minecraftVersion: string;
	modloader?: string;
	modloaderVersion?: string;
	width?: number;
	height?: number;
	minMemory?: number;
	maxMemory?: number;
	iconPath?: string;
	modpackId?: string;
	modpackVersionId?: string;
	modpackPlatform?: string;
	modpackIconUrl?: string;
	iconData?: Uint8Array;
}

// Metadata types from piston-lib
export interface GameVersionMetadata {
	id: string;
	version_type: string;
	release_time: string;
	stable: boolean;
	loaders: Record<string, LoaderVersionInfo[]>;
}

export interface LoaderVersionInfo {
	version: string;
	stable: boolean;
	metadata?: Record<string, any>;
	notification?: Record<string, any>;
}

export interface PistonMetadata {
	last_updated: string;
	game_versions: GameVersionMetadata[];
	latest: {
		release: string;
		snapshot: string;
	};
}

// Get all instances from database
export async function listInstances(): Promise<Instance[]> {
	return await invoke<Instance[]>("list_instances");
}

// Create a new instance (returns the new ID)
export async function createInstance(
	data: CreateInstanceData,
): Promise<number> {
	console.log("[createInstance] Called with data:", data);
	// Build full instance object with defaults
	const instance: Instance = {
		id: 0,
		name: data.name,
		minecraftVersion: data.minecraftVersion,
		modloader: (data.modloader === "vanilla" ? null : data.modloader) || null,
		modloaderVersion: data.modloaderVersion || null,
		javaPath: null,
		javaArgs: null,
		gameDirectory: null,
		width: data.width || 854,
		height: data.height || 480,
		minMemory: data.minMemory || 2048,
		maxMemory: data.maxMemory || 4096,
		iconPath: data.iconPath || null,
		lastPlayed: null,
		totalPlaytimeMinutes: 0,
		createdAt: null,
		updatedAt: null,
		modpackId: data.modpackId || null,
		modpackVersionId: data.modpackVersionId || null,
		modpackPlatform: data.modpackPlatform || null,
		modpackIconUrl: data.modpackIconUrl || null,
		iconData: data.iconData || null,
	};

	console.log(
		"[createInstance] Invoking Tauri command with instance:",
		instance,
	);
	try {
		const result = await invoke<number>("create_instance", {
			instanceData: instance,
		});
		console.log("[createInstance] DB insert successful, new ID:", result);
		return result;
	} catch (error) {
		console.error("[createInstance] Tauri command failed:", error);
		throw error;
	}
}

// Update an existing instance
export async function updateInstance(instance: Instance): Promise<void> {
	await invoke("update_instance", { instanceData: instance });
}

// Unlink instance from modpack
export async function unlinkInstance(instance: Instance): Promise<void> {
	const updated = {
		...instance,
		modpackId: null,
		modpackVersionId: null,
		modpackPlatform: null,
		modpackIconUrl: null,
		// We keep the iconData if it exists, as that's the "offline" version of the modpack icon
		// which the user might want to keep or change later.
	};
	await updateInstance(updated);
}

// Update instance modpack version
export async function updateInstanceModpackVersion(
	id: number,
	versionId: string,
): Promise<void> {
	await invoke("update_instance_modpack_version", {
		instanceId: id,
		versionId,
	});
}

// Duplicate an instance
export async function duplicateInstance(
	id: number,
	newName?: string,
): Promise<void> {
	await invoke("duplicate_instance", {
		instanceId: id,
		newName: newName || null,
	});
}

// Repair an instance
export async function repairInstance(id: number): Promise<void> {
	await invoke("repair_instance", { instanceId: id });
}

// Reset an instance (Hard Reset)
export async function resetInstance(id: number): Promise<void> {
	await invoke("reset_instance", { instanceId: id });
}

// Delete an instance
export async function deleteInstance(id: number): Promise<void> {
	await invoke("delete_instance", { instanceId: id });
}

// Get a single instance by ID
export async function getInstance(id: number): Promise<Instance> {
	return await invoke<Instance>("get_instance", { instanceId: id });
}

// Get a single instance by slug (unique instance identifier)
export async function getInstanceBySlug(slug: string): Promise<Instance> {
	return await invoke<Instance>("get_instance_by_slug", { slugVal: slug });
}

// Install an instance (queues installation task)
export async function installInstance(instance: Instance): Promise<void> {
	console.log(
		"[installInstance] Invoking Tauri command with instance:",
		instance,
	);
	try {
		await invoke("install_instance", { instanceData: instance });
		console.log("[installInstance] Tauri command completed successfully");
	} catch (error) {
		console.error("[installInstance] Tauri command failed:", error);
		throw error;
	}
}

// Launch an instance (placeholder implementation - backend may actually run the game)
export async function launchInstance(instance: Instance): Promise<void> {
	console.log(
		"[launchInstance] Invoking Tauri command to launch instance:",
		instance,
	);
	try {
		await invoke("launch_instance", { instanceData: instance });
		console.log("[launchInstance] Launch command completed");
	} catch (e) {
		console.error("[launchInstance] Launch command failed:", e);
		throw e;
	}
}
export async function killInstance(instance: Instance): Promise<string> {
	console.log(
		"[killInstance] Invoking Tauri command to kill instance:",
		instance,
	);
	try {
		const message = await invoke<string>("kill_instance", { inst: instance });
		console.log("[killInstance] Kill command completed: ", message);
		return message;
	} catch (e) {
		console.error("[killInstance] Kill command failed:", e);
		throw e;
	}
}

export async function isInstanceRunning(instance: Instance): Promise<boolean> {
	try {
		const result = await invoke<boolean>("is_instance_running", {
			instanceData: instance,
		});
		return result;
	} catch (e) {
		console.error("[isInstanceRunning] Check failed:", e);
		return false;
	}
}

// Get Minecraft versions metadata
export async function getMinecraftVersions(): Promise<PistonMetadata> {
	return await invoke<PistonMetadata>("get_minecraft_versions");
}

// Force-regenerate the PistonManifest (returns void, progress shown via notifications)
export async function reloadMinecraftVersions(): Promise<void> {
	await invoke<void>("regenerate_piston_manifest");
}

// Event listener for instance updates
let unsubscribeInstanceUpdate: (() => void) | null = null;
let unsubscribeInstanceInstalled: (() => void) | null = null;
let unsubscribeInstanceDeleted: (() => void) | null = null;

export async function subscribeToInstanceUpdates(callback: () => void) {
	// Listen for instance updates (DB changes) and instance-installed (installer finished)
	// Both events should trigger a refetch of the instances list in the UI.
	unsubscribeInstanceUpdate = await listen<Instance>(
		"core://instance-updated",
		() => {
			callback();
		},
	);

	// Also listen for installs completing so new instances appear immediately
	unsubscribeInstanceInstalled = await listen<{ name: string }>(
		"core://instance-installed",
		() => {
			callback();
		},
	);

	// Listen for instance deletion to remove it from UI
	unsubscribeInstanceDeleted = await listen<{ id: number }>(
		"core://instance-deleted",
		() => {
			callback();
		},
	);
}

export function unsubscribeFromInstanceUpdates() {
	if (unsubscribeInstanceUpdate) {
		unsubscribeInstanceUpdate();
		unsubscribeInstanceUpdate = null;
	}
	if (unsubscribeInstanceInstalled) {
		unsubscribeInstanceInstalled();
		unsubscribeInstanceInstalled = null;
	}
	if (unsubscribeInstanceDeleted) {
		unsubscribeInstanceDeleted();
		unsubscribeInstanceDeleted = null;
	}
}

// Helper to extract numeric ID from Instance id field
export function getInstanceId(instance: Instance): number | null {
	return instance.id;
}

// Create a filesystem-safe slug from an instance name — mirrors the backend sanitizer
export function sanitizeInstanceName(name: string): string {
	const n = (name || "").trim().toLowerCase();
	let out = "";
	let lastWasDash = false;

	for (const ch of n) {
		const code = ch.charCodeAt(0);
		const isAlphaNum =
			(code >= 48 && code <= 57) || (code >= 97 && code <= 122);
		if (isAlphaNum) {
			out += ch;
			lastWasDash = false;
		} else if (ch === "-" || ch === "_") {
			out += ch;
			lastWasDash = false;
		} else if (/[\s\p{P}]/u.test(ch)) {
			if (!lastWasDash) {
				out += "-";
				lastWasDash = true;
			}
		} else {
			if (!lastWasDash) {
				out += "-";
				lastWasDash = true;
			}
		}
	}

	out = out.replace(/^-+|-+$/g, "");
	if (out.length === 0) return "instance";
	if (out.length > 64) return out.slice(0, 64);
	return out;
}

export function getInstanceSlug(instance: Instance): string {
	return sanitizeInstanceName(instance.name);
}
