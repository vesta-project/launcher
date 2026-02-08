import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { batch } from "solid-js";
import {
	applyTheme,
	configToTheme,
	type AppThemeConfig,
} from "../themes/presets";

interface ConfigUpdateEvent {
	field: string;
	value: any;
}

type ConfigUpdateHandler = (field: string, value: any) => void;

let configUnlisten: UnlistenFn | null = null;
const updateHandlers: Set<ConfigUpdateHandler> = new Set();

function setReducedMotion(enabled: boolean): void {
	const root = document.documentElement;
	root.dataset.reducedMotion = enabled ? "true" : "false";

	if (enabled) {
		root.style.setProperty("scroll-behavior", "auto");
	} else {
		root.style.removeProperty("scroll-behavior");
	}
}

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

let setupPromise: Promise<void> | null = null;

/**
 * Subscribe to config updates from other windows
 * Broadcasts errors if updates fail
 */
export async function subscribeToConfigUpdates(): Promise<void> {
	if (setupPromise) return setupPromise;

	setupPromise = (async () => {
		let updateQueue: ConfigUpdateEvent[] = [];
		let batchTimeout: any = null;

		configUnlisten = await listen<ConfigUpdateEvent>(
			"config-updated",
			(event) => {
				updateQueue.push(event.payload);

				if (batchTimeout) return;

				batchTimeout = setTimeout(() => {
					const currentUpdates = [...updateQueue];
					updateQueue = [];
					batchTimeout = null;

					batch(() => {
						for (const { field, value } of currentUpdates) {
							// Notify all registered handlers
							updateHandlers.forEach((handler) => {
								try {
									handler(field, value);
								} catch (error) {
									console.error(
										`Handler failed for config update ${field}:`,
										error,
									);
								}
							});

							console.log(`Config synced (batched): ${field} = ${value}`);
						}
					});
				}, 16); // ~1 frame at 60fps
			},
		);
	})();

	await setupPromise;
}

/**
 * Unsubscribe from config updates
 */
export function unsubscribeFromConfigUpdates(): void {
	if (configUnlisten) {
		configUnlisten();
		configUnlisten = null;
		setupPromise = null;
		updateHandlers.clear();
		console.log("Unsubscribed from config updates");
	}
}

export let currentThemeConfig: Partial<AppThemeConfig> = {};

/**
 * Update the local theme config cache without triggering an apply
 * This is useful for keeping the cache in sync with UI signals before they are committed
 */
export function updateThemeConfigLocal(field: string, value: any): void {
	if (field.startsWith("theme_") || field === "background_hue") {
		(currentThemeConfig as any)[field] = value;
	}
}

/**
 * Apply common config updates (CSS variables, etc.)
 * This is a default handler that can be registered
 */
export function applyCommonConfigUpdates(field: string, value: any): void {
	// Handle theme-related fields
	if (field.startsWith("theme_") || field === "background_hue") {
		(currentThemeConfig as any)[field] = value;
		applyTheme(configToTheme(currentThemeConfig));
	}

	if (field === "reduced_motion" && typeof value === "boolean") {
		setReducedMotion(value);
	}
	// Add more common handlers here as needed
}

/** Apply a full config snapshot (used at startup) */
export function applyConfigSnapshot(config: Record<string, any>): void {
	// Extract theme fields for the initial application
	currentThemeConfig = {
		theme_id: config.theme_id,
		theme_mode: config.theme_mode,
		theme_primary_hue: config.theme_primary_hue,
		theme_primary_sat: config.theme_primary_sat,
		theme_primary_light: config.theme_primary_light,
		theme_style: config.theme_style,
		theme_gradient_enabled: config.theme_gradient_enabled,
		theme_gradient_angle: config.theme_gradient_angle,
		theme_gradient_type: config.theme_gradient_type,
		theme_gradient_harmony: config.theme_gradient_harmony,
		theme_advanced_overrides: config.theme_advanced_overrides,
		background_hue: config.background_hue,
	};

	applyTheme(configToTheme(currentThemeConfig));

	if (typeof config.reduced_motion === "boolean") {
		applyCommonConfigUpdates("reduced_motion", config.reduced_motion);
	}
}

/**
 * Get the current debug logging state
 * This allows modules to check debug logging without subscribing
 */
export function getDebugLoggingEnabled(): boolean {
	// This could be enhanced to actually read from a central config store
	// For now, return a default or check localStorage/sessionStorage
	return false; // Default to disabled
}
