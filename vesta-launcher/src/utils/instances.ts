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

export const DEMO_INSTANCE_ID = -1;
export const DEMO_INSTANCE_SLUG = "vesta-explorer-demo";

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
];

export const BUILTIN_ICON_PREFIX = "builtin:placeholder-";

/**
 * Returns a stable identifier for a default launcher icon.
 * If the path is already a stable ID, returns it.
 * If the path contains "placeholder-imageX", returns "builtin:placeholder-X".
 * Otherwise returns the input as-is.
 */
export function getStableIconId(
	path: string | null | undefined,
): string | null | undefined {
	if (!path) return path;
	if (path.startsWith(BUILTIN_ICON_PREFIX)) return path;

	const match = path.match(/placeholder-image(\d+)/i);
	if (match && match[1]) {
		const index = parseInt(match[1]);
		if (index >= 1 && index <= DEFAULT_ICONS.length) {
			return `${BUILTIN_ICON_PREFIX}${index}`;
		}
	}

	return path;
}

/**
 * Resolves a stable identifier or a legacy hashed path to the current build's icon URL.
 * If the path contains "placeholder-imageX" or "placeholder-X",
 * it returns the corresponding URL from the current DEFAULT_ICONS array.
 */
export function resolveBuiltinIcon(path: string): string {
	const match =
		path.match(/placeholder-image(\d+)/i) || path.match(/placeholder-(\d+)/i);
	if (match && match[1]) {
		const index = parseInt(match[1]);
		if (index >= 1 && index <= DEFAULT_ICONS.length) {
			return DEFAULT_ICONS[index - 1];
		}
	}
	return path;
}

/**
 * Checks if a given path or ID refers to a default launcher icon.
 */
export function isDefaultIcon(path: string | null | undefined): boolean {
	if (!path) return false;
	if (path.startsWith(BUILTIN_ICON_PREFIX)) return true;
	if (DEFAULT_ICONS.includes(path)) return true;
	return /placeholder-image(\d+)/i.test(path);
}

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
		| "interrupted"
		| null;
	crashed?: boolean;
	crashDetails?: string | null;
	modpackId: string | null;
	modpackVersionId: string | null;
	modpackPlatform: string | null;
	modpackIconUrl: string | null;
	iconData: Uint8Array | null;

	// Instance Defaults & Linking
	useGlobalResolution: boolean;
	useGlobalMemory: boolean;
	useGlobalJavaArgs: boolean;
	useGlobalJavaPath: boolean;
	useGlobalHooks: boolean;
	useGlobalEnvironmentVariables: boolean;
	useGlobalGameDir: boolean;
	gameWidth: number;
	gameHeight: number;
	environmentVariables: string | null;
	preLaunchHook: string | null;
	postExitHook: string | null;
	wrapperCommand: string | null;

	/**
	 * Identifier of the last lifecycle operation performed on this instance.
	 *
	 * This is set by the backend/task manager whenever a significant operation
	 * is executed for the instance, and can be used by the frontend to show
	 * contextual status or history in the UI.
	 *
	 * Common values include:
	 * - "install"      — initial installation of the instance/modpack
	 * - "repair"       — repair or re-apply the instance files
	 * - "hard-reset"   — full reset of the instance to a clean state
	 * - "update"       — update of the instance or its modpack
	 *
	 * May be `null` or `undefined` if no tracked operation has been performed yet,
	 * or if the backend does not report an operation for this instance.
	 */
	lastOperation?: string | null;
}

// Simplified version for creating new instances
export interface CreateInstanceData {
	name: string;
	minecraftVersion: string;
	modloader?: string;
	modloaderVersion?: string;
	gameWidth?: number;
	gameHeight?: number;
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

/** Returns the virtual demo instance object used in Guest mode */
export function createDemoInstance(): Instance {
	return {
		id: DEMO_INSTANCE_ID,
		name: "Vesta Explorer (Demo)",
		minecraftVersion: "1.20.1",
		modloader: "Fabric",
		modloaderVersion: "0.15.3",
		javaPath: null,
		javaArgs: null,
		gameDirectory: null,
		gameWidth: 854,
		gameHeight: 480,
		minMemory: 1024,
		maxMemory: 4096,
		iconPath: null,
		lastPlayed: null,
		totalPlaytimeMinutes: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		installationStatus: "installed",
		crashed: false,
		crashDetails: null,
		modpackId: null,
		modpackVersionId: null,
		modpackPlatform: null,
		modpackIconUrl: null,
		iconData: null,
		useGlobalResolution: false,
		useGlobalMemory: false,
		useGlobalJavaArgs: false,
		useGlobalJavaPath: false,
		useGlobalHooks: false,
		useGlobalEnvironmentVariables: false,
		useGlobalGameDir: false,
		environmentVariables: null,
		preLaunchHook: null,
		postExitHook: null,
		wrapperCommand: null,
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
		gameWidth: data.gameWidth || 854,
		gameHeight: data.gameHeight || 480,
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
		useGlobalResolution: true,
		useGlobalMemory: true,
		useGlobalJavaArgs: true,
		useGlobalJavaPath: true,
		useGlobalHooks: true,
		useGlobalEnvironmentVariables: true,
		useGlobalGameDir: true,
		environmentVariables: null,
		preLaunchHook: null,
		postExitHook: null,
		wrapperCommand: null,
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

// Resume an interrupted operation
export async function resumeInstanceOperation(
	instance: Instance,
): Promise<void> {
	// Fallback to 'install' if no specific operation is recorded, as it's the
	// most common initial operation that would need resuming.
	const operation = instance.lastOperation || "install";

	switch (operation) {
		case "repair":
			await repairInstance(instance.id);
			break;
		case "hard-reset":
			await resetInstance(instance.id);
			break;
		case "install":
		default:
			await installInstance(instance);
			break;
	}
}

// Delete an instance
export async function deleteInstance(id: number): Promise<void> {
	await invoke("delete_instance", { instanceId: id });
}

// Get a single instance by ID
export async function getInstance(id: number): Promise<Instance> {
	if (id === DEMO_INSTANCE_ID) {
		return createDemoInstance();
	}
	return await invoke<Instance>("get_instance", { instanceId: id });
}

// Get a single instance by slug (unique instance identifier)
export async function getInstanceBySlug(slug: string): Promise<Instance> {
	if (slug === DEMO_INSTANCE_SLUG) {
		return createDemoInstance();
	}
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
