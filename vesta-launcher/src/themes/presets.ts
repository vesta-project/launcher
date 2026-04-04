export { PRESET_THEMES } from "./presets/builtin";

import { parseThemeData } from "./engine/parser";
import { getDefaultTheme, validateTheme } from "./engine/validation";
import { PRESET_THEMES } from "./presets/builtin";
import type { AppThemeConfig, ThemeConfig } from "./types";

export type {
	AppThemeConfig,
	GradientHarmony,
	StyleMode,
	ThemeConfig,
	ThemeDataPayload,
	ThemeVariable,
	ThemeVariableType,
	ThemeVariableValue
} from "./types";

/**
 * Vesta Launcher Theme System - Theme Management
 */

const customThemeRegistry = new Map<string, ThemeConfig>();

export function setCustomThemes(themes: ThemeConfig[]): void {
	customThemeRegistry.clear();
	for (const theme of themes) {
		customThemeRegistry.set(theme.id, validateTheme(theme));
	}
}

export function upsertCustomTheme(theme: ThemeConfig): void {
	customThemeRegistry.set(theme.id, validateTheme(theme));
}

export function removeCustomTheme(themeId: string): void {
	customThemeRegistry.delete(themeId);
}

export function getCustomThemes(): ThemeConfig[] {
	return [...customThemeRegistry.values()];
}

export function getAllThemes(): ThemeConfig[] {
	return [...PRESET_THEMES, ...getCustomThemes()];
}

/**
 * Convert backend config to a full ThemeConfig
 */
export function configToTheme(config: Partial<AppThemeConfig>): ThemeConfig {
	const themeId = config.theme_id || "vesta";
	const baseTheme = getThemeById(themeId) || getDefaultTheme();

	// Helper to get a numeric value that might be 0
	const getNum = (val: any) => (typeof val === "number" ? val : undefined);
	const themeData = parseThemeData(config.theme_data);

	return validateTheme({
		...baseTheme,
		id: themeData.id ?? themeId,
		name: themeData.name ?? baseTheme.name,
		description: themeData.description ?? baseTheme.description,
		primaryHue:
			getNum(themeData.primaryHue) ??
			getNum(config.theme_primary_hue) ??
			getNum(config.background_hue) ??
			baseTheme.primaryHue ??
			180,
		opacity: getNum(themeData.opacity) ?? baseTheme.opacity ?? 0,
		borderWidth:
			themeData.borderWidth ??
			config.theme_border_width ??
			baseTheme.borderWidth,
		style: themeData.style ?? config.theme_style ?? baseTheme.style,
		gradientEnabled:
			themeData.gradientEnabled ??
			config.theme_gradient_enabled ??
			baseTheme.gradientEnabled,
		rotation:
			getNum(themeData.rotation) ??
			getNum(config.theme_gradient_angle) ??
			baseTheme.rotation,
		gradientType:
			themeData.gradientType ??
			config.theme_gradient_type ??
			baseTheme.gradientType,
		gradientHarmony:
			themeData.gradientHarmony ??
			config.theme_gradient_harmony ??
			baseTheme.gradientHarmony,
		customCss:
			themeData.customCss && themeData.customCss.trim().length > 0
				? themeData.customCss
				: config.theme_advanced_overrides &&
						config.theme_advanced_overrides.trim().length > 0
					? config.theme_advanced_overrides
					: baseTheme.customCss,
		windowEffect:
			themeData.windowEffect ??
			config.theme_window_effect ??
			baseTheme.windowEffect,
		backgroundOpacity:
			themeData.backgroundOpacity ??
			config.theme_background_opacity ??
			baseTheme.backgroundOpacity,
		author: themeData.author ?? baseTheme.author,
		variables: themeData.variables ?? baseTheme.variables,
		userVariables: themeData.userVariables,
	});
}
/**
 * Get a theme by ID
 */
export function getThemeById(id: string): ThemeConfig | undefined {
	return (
		customThemeRegistry.get(id) ||
		PRESET_THEMES.find((theme) => theme.id === id)
	);
}

export {
	applyTheme,
	type ThemeApplyOptions,
	type ThemeApplyTransition
} from "./engine/applier";
export {
	getSupportedWindowEffects,
	loadWindowEffectCapabilities,
	normalizeWindowEffectForCurrentOS
} from "./engine/effects";
// Re-export common engine functions for convenience
export { parseThemeData, serializeThemeData } from "./engine/parser";
export { themeToCSSVars } from "./engine/themeToCSSVars";
export {
	getDefaultTheme,
	isBuiltinThemeId,
	validateTheme
} from "./engine/validation";

