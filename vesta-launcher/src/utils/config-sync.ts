import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { batch } from "solid-js";
import { createStore } from "solid-js/store";
import {
	type AppThemeConfig,
	applyTheme,
	configToTheme,
	getThemeById,
	PRESET_THEMES,
	parseThemeData,
	serializeThemeData,
	type ThemeVariableValue,
} from "../themes/presets";

interface ConfigUpdateEvent {
	field: string;
	value: any;
}

type ConfigUpdateHandler = (field: string, value: any) => void;

function isThemeConfigField(field: string): boolean {
	return field.startsWith("theme_") || field === "background_hue";
}

function buildDefaultUserVariables(
	variables: unknown,
): Record<string, ThemeVariableValue> {
	if (!Array.isArray(variables)) return {};

	const defaults: Record<string, ThemeVariableValue> = {};
	for (const entry of variables) {
		if (!entry || typeof entry !== "object") continue;

		const candidate = entry as { key?: unknown; default?: unknown };
		if (
			typeof candidate.key === "string" &&
			(typeof candidate.default === "number" ||
				typeof candidate.default === "string" ||
				typeof candidate.default === "boolean")
		) {
			defaults[candidate.key] = candidate.default;
		}
	}

	return defaults;
}

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
					let hasThemeUpdate = false;

					batch(() => {
						for (const { field, value } of currentUpdates) {
							if (isThemeConfigField(field)) {
								hasThemeUpdate = true;
							}

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

						if (hasThemeUpdate) {
							applyTheme(configToTheme(currentThemeConfig));
						}
					});
				}, 0);
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

/**
 * Global reactive configuration state
 * Using a SolidJS Store ensures nested updates (like theme_data) are tracked by components
 */
export const [currentThemeConfig, setCurrentThemeConfig] = createStore<
	Partial<AppThemeConfig>
>({
	theme_background_opacity: 25,
});

/**
 * Update the local theme config cache without triggering an apply
 * This is useful for keeping the cache in sync with UI signals before they are committed
 */
export function updateThemeConfigLocal(field: string, value: any): void {
	if (isThemeConfigField(field)) {
		setCurrentThemeConfig(field as any, value);
	}
}

/**
 * Apply common config updates (CSS variables, etc.)
 * This is a default handler that can be registered
 */
export function applyCommonConfigUpdates(field: string, value: any): void {
	// Handle theme-related fields
	if (isThemeConfigField(field)) {
		// Prevent redundant applications if the value hasn't actually changed
		// Note: Store updates are reactive, so we check the current untracked value
		if (currentThemeConfig[field as keyof AppThemeConfig] === value) {
			return;
		}

		if (field === "theme_data" && typeof value === "string") {
			try {
				// We don't need a separate field for parsed, but we could reconcile here
				// if we wanted nested granularity. For now, we update the string.
				setCurrentThemeConfig("theme_data", value);
			} catch (e) {
				console.error("Failed to sync theme_data:", e);
			}
		} else {
			setCurrentThemeConfig(field as any, value);
		}
	}

	if (field === "reduced_motion" && typeof value === "boolean") {
		setReducedMotion(value);
	}
	// Add more common handlers here as needed
}

/**
 * Persist theme configuration to the backend
 * This is the central source of truth for saving theme updates
 */
export async function saveThemeUpdate(
	overrides: Partial<{
		themeName: string;
		author: string;
		description: string;
		primaryHue: number;
		primarySat: number;
		primaryLight: number;
		opacity: number;
		style: string;
		gradientEnabled: boolean;
		rotation: number;
		gradientType: "linear" | "radial";
		gradientHarmony: string;
		borderWidth: number;
		backgroundOpacity: number;
		windowEffect: string;
		customCss: string;
		variables: unknown;
		userVariables: Record<string, ThemeVariableValue>;
		themeId: string;
	}> = {},
) {
	if (!hasTauriRuntime()) return;

	// 1. Resolve target theme
	const tid = overrides.themeId || currentThemeConfig.theme_id || "vesta";
	const theme = getThemeById(tid) || PRESET_THEMES[0];

	// 2. Build the JSON blob
	const currentThemeData = parseThemeData(currentThemeConfig.theme_data);
	const currentThemeDataId = currentThemeData.id ?? currentThemeConfig.theme_id;
	const shouldCarryCurrentThemeData = currentThemeDataId === tid;
	const sameThemeAsStore = currentThemeConfig.theme_id === tid;
	const carriedThemeData = shouldCarryCurrentThemeData ? currentThemeData : {};

	const activeVariables =
		(overrides.variables as any) ??
		carriedThemeData.variables ??
		theme.variables;
	const fallbackUserVariables = buildDefaultUserVariables(activeVariables);
	const updatedUserVariables =
		overrides.userVariables ??
		carriedThemeData.userVariables ??
		fallbackUserVariables;

	const activeHue =
		overrides.primaryHue ??
		carriedThemeData.primaryHue ??
		(sameThemeAsStore ? currentThemeConfig.theme_primary_hue : undefined) ??
		theme.primaryHue ??
		180;
	const activeStyle =
		overrides.style ??
		carriedThemeData.style ??
		(sameThemeAsStore ? currentThemeConfig.theme_style : undefined) ??
		theme.style ??
		"glass";
	const activeGradientEnabled =
		overrides.gradientEnabled ??
		carriedThemeData.gradientEnabled ??
		(sameThemeAsStore
			? currentThemeConfig.theme_gradient_enabled
			: undefined) ??
		theme.gradientEnabled ??
		true;
	const activeRotation =
		overrides.rotation ??
		carriedThemeData.rotation ??
		(sameThemeAsStore ? currentThemeConfig.theme_gradient_angle : undefined) ??
		theme.rotation ??
		135;
	const activeGradientType =
		overrides.gradientType ??
		carriedThemeData.gradientType ??
		(sameThemeAsStore ? currentThemeConfig.theme_gradient_type : undefined) ??
		theme.gradientType ??
		"linear";
	const activeGradientHarmony =
		overrides.gradientHarmony ??
		carriedThemeData.gradientHarmony ??
		(sameThemeAsStore
			? currentThemeConfig.theme_gradient_harmony
			: undefined) ??
		theme.gradientHarmony ??
		"none";
	const activeBorderWidth =
		overrides.borderWidth ??
		carriedThemeData.borderWidth ??
		(sameThemeAsStore ? currentThemeConfig.theme_border_width : undefined) ??
		theme.borderWidth ??
		1;
	const activeBackgroundOpacity =
		overrides.backgroundOpacity ??
		carriedThemeData.backgroundOpacity ??
		(sameThemeAsStore
			? currentThemeConfig.theme_background_opacity
			: undefined) ??
		theme.backgroundOpacity ??
		25;
	const activeWindowEffect =
		overrides.windowEffect ??
		carriedThemeData.windowEffect ??
		(sameThemeAsStore ? currentThemeConfig.theme_window_effect : undefined) ??
		theme.windowEffect;
	const activeCustomCss =
		overrides.customCss ?? carriedThemeData.customCss ?? theme.customCss;

	const themeData = serializeThemeData({
		id: tid,
		name: overrides.themeName ?? carriedThemeData.name ?? theme.name,
		author: overrides.author ?? carriedThemeData.author ?? theme.author,
		description:
			overrides.description ??
			carriedThemeData.description ??
			theme.description,
		primaryHue: activeHue,
		primarySat:
			overrides.primarySat ??
			carriedThemeData.primarySat ??
			(sameThemeAsStore ? currentThemeConfig.theme_primary_sat : undefined) ??
			theme.primarySat,
		primaryLight:
			overrides.primaryLight ??
			carriedThemeData.primaryLight ??
			(sameThemeAsStore ? currentThemeConfig.theme_primary_light : undefined) ??
			theme.primaryLight,
		opacity: overrides.opacity ?? carriedThemeData.opacity ?? theme.opacity,
		style: activeStyle as any,
		gradientEnabled: activeGradientEnabled,
		rotation: activeRotation,
		gradientType: activeGradientType,
		gradientHarmony: activeGradientHarmony as any,
		borderWidth: activeBorderWidth,
		backgroundOpacity: activeBackgroundOpacity,
		windowEffect: activeWindowEffect,
		customCss: activeCustomCss,
		variables: activeVariables,
		userVariables: updatedUserVariables,
	});

	// 3. Update local store (Immediate UI feedback)
	batch(() => {
		setCurrentThemeConfig("theme_id", tid);
		setCurrentThemeConfig("theme_data", themeData);
		setCurrentThemeConfig("theme_primary_hue", activeHue);
		setCurrentThemeConfig("theme_style", activeStyle as any);
		setCurrentThemeConfig(
			"theme_gradient_enabled",
			activeGradientEnabled as any,
		);
		setCurrentThemeConfig("theme_gradient_angle", activeRotation as any);
		setCurrentThemeConfig("theme_gradient_type", activeGradientType as any);
		setCurrentThemeConfig(
			"theme_gradient_harmony",
			activeGradientHarmony as any,
		);
		setCurrentThemeConfig(
			"theme_background_opacity",
			activeBackgroundOpacity as any,
		);
		setCurrentThemeConfig("theme_border_width", activeBorderWidth as any);
		if (activeWindowEffect !== undefined) {
			setCurrentThemeConfig("theme_window_effect", activeWindowEffect as any);
		}
	});

	// 4. Persistence call
	try {
		const updates: Record<string, unknown> = {
			theme_id: tid,
			theme_data: themeData,
			theme_primary_hue: activeHue,
			background_hue: activeHue,
			theme_style: activeStyle,
			theme_gradient_enabled: activeGradientEnabled,
			theme_gradient_angle: activeRotation,
			theme_gradient_type: activeGradientType,
			theme_gradient_harmony: activeGradientHarmony,
			theme_border_width: activeBorderWidth,
			theme_background_opacity: activeBackgroundOpacity,
		};

		if (activeWindowEffect !== undefined) {
			updates.theme_window_effect = activeWindowEffect;
		}

		await invoke("update_config_fields", {
			updates,
		});
	} catch (e) {
		console.error("Failed to persist theme state from central store:", e);
	}
}

/** Apply a full config snapshot (used at startup) */
export function applyConfigSnapshot(config: Record<string, any>): void {
	// Extract theme fields for the initial application
	const snapshot: Partial<AppThemeConfig> = {
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
		theme_border_width: config.theme_border_width,
		theme_background_opacity: config.theme_background_opacity,
		theme_window_effect: config.theme_window_effect,
		theme_data: config.theme_data,
		background_hue: config.background_hue,
	};

	batch(() => {
		setCurrentThemeConfig(snapshot);
	});

	applyTheme(configToTheme(snapshot));

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
