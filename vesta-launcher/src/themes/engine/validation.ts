import { PRESET_THEMES } from "../presets/builtin";
import type { ThemeConfig, ThemeVariable, ThemeVariableValue } from "../types";
import { getCurrentOsHint, normalizeWindowEffectForCurrentOS } from "./effects";
import { clamp } from "./utils";

/**
 * Strip malicious or structural-breaking css from user themes.
 */
export function sanitizeCustomCss(css: string): string {
	if (!css) return css;

	const lowered = css.toLowerCase();
	const blockedTokens = [
		"@import",
		"javascript:",
		"expression(",
		"<script",
		"</script",
		"-moz-binding",
		"behavior:",
	];

	for (const token of blockedTokens) {
		if (lowered.includes(token)) {
			console.warn("Theme rejected: Potentially unsafe CSS detected.", token);
			return "";
		}
	}

	return css;
}

export function isBuiltinThemeId(id: string): boolean {
	return PRESET_THEMES.some((theme) => theme.id === id);
}

export function getDefaultTheme(): ThemeConfig {
	return PRESET_THEMES[0];
}

export function normalizeUserVariables(
	userVariables?: Record<string, ThemeVariableValue>,
	definitions?: ThemeVariable[],
): Record<string, ThemeVariableValue> | undefined {
	if (!definitions || definitions.length === 0) {
		if (!userVariables) return undefined;
		const filtered: Record<string, ThemeVariableValue> = {};
		for (const [key, value] of Object.entries(userVariables)) {
			if (
				typeof value === "number" ||
				typeof value === "string" ||
				typeof value === "boolean"
			) {
				filtered[key] = value;
			}
		}
		return Object.keys(filtered).length > 0 ? filtered : undefined;
	}

	const normalized: Record<string, ThemeVariableValue> = {};
	for (const variable of definitions) {
		const candidate = userVariables?.[variable.key];

		if (variable.type === "number") {
			const value =
				typeof candidate === "number" ? candidate : variable.default;
			normalized[variable.key] = clamp(value, variable.min, variable.max);
			continue;
		}

		if (variable.type === "color") {
			normalized[variable.key] =
				typeof candidate === "string" ? candidate : variable.default;
			continue;
		}

		if (variable.type === "boolean") {
			normalized[variable.key] =
				typeof candidate === "boolean" ? candidate : variable.default;
			continue;
		}

		if (variable.type === "select") {
			const selected =
				typeof candidate === "string" ? candidate : variable.default;
			const isAllowed = variable.options.some((opt) => opt.value === selected);
			normalized[variable.key] = isAllowed ? selected : variable.default;
		}
	}

	return normalized;
}

export function validateTheme(theme: Partial<ThemeConfig>): ThemeConfig {
	const defaultTheme = getDefaultTheme();

	// Helper to handle null/undefined from backend
	const getVal = <T>(val: T | null | undefined, fallback: T): T =>
		val !== null && val !== undefined ? val : fallback;

	return {
		id: theme.id || "custom",
		name: theme.name || "Custom Theme",
		libraryId: theme.libraryId,
		author: theme.author || defaultTheme.author,
		source:
			theme.source ||
			(isBuiltinThemeId(theme.id || "custom") ? "builtin" : "imported"),
		description: theme.description,
		primaryHue: clamp(
			getVal(theme.primaryHue, defaultTheme.primaryHue),
			0,
			360,
		),
		primarySat:
			theme.primarySat !== undefined && theme.primarySat !== null
				? clamp(theme.primarySat, 0, 100)
				: undefined,
		primaryLight:
			theme.primaryLight !== undefined && theme.primaryLight !== null
				? clamp(theme.primaryLight, 0, 100)
				: undefined,
		opacity: clamp(getVal(theme.opacity, defaultTheme.opacity ?? 0), 0, 100),
		borderWidth: clamp(
			getVal(theme.borderWidth, defaultTheme.borderWidth ?? 1),
			0,
			10,
		),
		style: theme.style || defaultTheme.style,
		colorScheme: theme.colorScheme || defaultTheme.colorScheme,
		gradientEnabled: theme.gradientEnabled ?? defaultTheme.gradientEnabled,
		rotation:
			theme.rotation !== undefined && theme.rotation !== null
				? clamp(theme.rotation, 0, 360)
				: undefined,
		gradientType: theme.gradientType || "linear",
		gradientHarmony: theme.gradientHarmony || "none",
		thumbnail: theme.thumbnail,
		customCss: theme.customCss ? sanitizeCustomCss(theme.customCss) : undefined,
		allowHueChange: theme.allowHueChange,
		allowStyleChange: theme.allowStyleChange,
		allowBorderChange: theme.allowBorderChange,
		windowEffect: normalizeWindowEffectForCurrentOS(
			theme.windowEffect ||
				(getCurrentOsHint() === "windows"
					? "mica"
					: getCurrentOsHint() === "macos"
						? "vibrancy"
						: "none"),
		),
		backgroundOpacity:
			theme.backgroundOpacity !== undefined ? theme.backgroundOpacity : 25,
		variables: theme.variables,
		userVariables: normalizeUserVariables(theme.userVariables, theme.variables),
	};
}
