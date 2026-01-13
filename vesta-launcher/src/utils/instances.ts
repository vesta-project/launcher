import PlaceholderImage1 from "@assets/placeholder-images/placeholder-image1.jpg";
import PlaceholderImage2 from "@assets/placeholder-images/placeholder-image2.png";
import PlaceholderImage3 from "@assets/placeholder-images/placeholder-image3.png";
import PlaceholderImage4 from "@assets/placeholder-images/placeholder-image4.png";
import PlaceholderImage5 from "@assets/placeholder-images/placeholder-image5.png";
import PlaceholderImage6 from "@assets/placeholder-images/placeholder-image6.png";
import PlaceholderImage7 from "@assets/placeholder-images/placeholder-image7.png";
import PlaceholderImage8 from "@assets/placeholder-images/placeholder-image8.png";
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
	memoryMb: number;
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
}

// Simplified version for creating new instances
export interface CreateInstanceData {
	name: string;
	minecraftVersion: string;
	modloader?: string;
	modloaderVersion?: string;
	width?: number;
	height?: number;
	memoryMb?: number;
	iconPath?: string;
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
		modloader: data.modloader || "vanilla",
		modloaderVersion: data.modloaderVersion || null,
		javaPath: null,
		javaArgs: null,
		gameDirectory: null,
		width: data.width || 854,
		height: data.height || 480,
		memoryMb: data.memoryMb || 2048,
		iconPath: data.iconPath || null,
		lastPlayed: null,
		totalPlaytimeMinutes: 0,
		createdAt: null,
		updatedAt: null,
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
