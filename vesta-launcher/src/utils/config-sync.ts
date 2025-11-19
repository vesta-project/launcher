import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriRuntime } from "@utils/tauri-runtime";

interface ConfigUpdateEvent {
	field: string;
	value: any;
}

type ConfigUpdateHandler = (field: string, value: any) => void;

let configUnlisten: UnlistenFn | null = null;
let currentWindowLabel: string | null = null;
const updateHandlers: Set<ConfigUpdateHandler> = new Set();

/**
 * Register a handler to be called when config updates arrive
 */
export function onConfigUpdate(handler: ConfigUpdateHandler): () => void {
	updateHandlers.add(handler);
	
	// Return unsubscribe function
	return () => {
		updateHandlers.delete(handler);
	};
}

/**
 * Subscribe to config updates from other windows
 * Broadcasts errors if updates fail
 */
export async function subscribeToConfigUpdates(): Promise<void> {
	if (configUnlisten) {
		console.warn("Already subscribed to config updates");
		return;
	}

	// Get current window label to track update source
	try {
		currentWindowLabel = getCurrentWindow().label;
	} catch (error) {
		console.error("Failed to get current window label:", error);
	}

	configUnlisten = await listen<ConfigUpdateEvent>(
		"config-updated",
		(event) => {
			const { field, value } = event.payload;

			try {
				// Notify all registered handlers
				updateHandlers.forEach((handler) => {
					try {
						handler(field, value);
					} catch (error) {
						console.error(`Handler failed for config update ${field}:`, error);
					}
				});
				
				console.log(`Config synced: ${field} = ${value}`);
			} catch (error) {
				const errorMsg = `Failed to process config update: ${field} = ${value}`;
				console.error(errorMsg, error);
				
				// Broadcast error event for other windows to be aware
				if (hasTauriRuntime()) {
					import("@tauri-apps/api/event").then(({ emit }) => {
						emit("config-update-error", {
							field,
							value,
							error: error instanceof Error ? error.message : String(error),
							window: currentWindowLabel,
						});
					});
				}
			}
		}
	);
}

/**
 * Unsubscribe from config updates
 */
export function unsubscribeFromConfigUpdates(): void {
	if (configUnlisten) {
		configUnlisten();
		configUnlisten = null;
		updateHandlers.clear();
		console.log("Unsubscribed from config updates");
	}
}

/**
 * Apply common config updates (CSS variables, etc.)
 * This is a default handler that can be registered
 */
export function applyCommonConfigUpdates(field: string, value: any): void {
	if (field === "background_hue" && typeof value === "number") {
		document.documentElement.style.setProperty(
			"--color__primary-hue",
			value.toString()
		);
	}
	// Add more common handlers here as needed
}

/**
 * Get the current debug logging state
 * This allows modules to check debug logging without subscribing
 */
export function getDebugLoggingEnabled(): boolean {
	// This could be enhanced to actually read from a central config store
	// For now, return a default or check localStorage/sessionStorage
	return true; // Default to disabled
}
