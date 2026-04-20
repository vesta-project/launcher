import { PRESET_THEMES } from "../presets/builtin";
import type { ThemeConfig, ThemeVariable, ThemeVariableValue } from "../types";
import { getCurrentOsHint, normalizeWindowEffectForCurrentOS } from "./effects";
import { normalizeStyleMode } from "./parser";
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
			if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
				filtered[key] = value;
			}
		}
		return Object.keys(filtered).length > 0 ? filtered : undefined;
	}

	const normalized: Record<string, ThemeVariableValue> = {};
	for (const variable of definitions) {
		const candidate = userVariables?.[variable.key];

		if (variable.type === "number") {
			const value = typeof candidate === "number" ? candidate : variable.default;
			normalized[variable.key] = clamp(value, variable.min, variable.max);
			continue;
		}

		if (variable.type === "color") {
			normalized[variable.key] = typeof candidate === "string" ? candidate : variable.default;
			continue;
		}

		if (variable.type === "boolean") {
			normalized[variable.key] = typeof candidate === "boolean" ? candidate : variable.default;
			continue;
		}

		if (variable.type === "select") {
			const selected = typeof candidate === "string" ? candidate : variable.default;
			const isAllowed = variable.options.some((opt) => opt.value === selected);
			normalized[variable.key] = isAllowed ? selected : variable.default;
		}
	}

	return normalized;
}

export function validateTheme(theme: Partial<ThemeConfig>): ThemeConfig {
	const defaultTheme = getDefaultTheme();
	const resolvedId = theme.id || "custom";
	const presetFallback = PRESET_THEMES.find((candidate) => candidate.id === resolvedId);
	const fallbackTheme = presetFallback ?? defaultTheme;
	const source: ThemeConfig["source"] =
		theme.source || (isBuiltinThemeId(resolvedId) ? "builtin" : "imported");

	const resolveEditability = (
		candidate: boolean | undefined,
		fallback: boolean | undefined,
	): boolean | undefined => {
		if (candidate !== undefined) return candidate;
		if (source === "imported") return false;
		return fallback;
	};

	// Helper to handle null/undefined from backend
	const getVal = <T>(val: T | null | undefined, fallback: T): T =>
		val !== null && val !== undefined ? val : fallback;

	return {
		id: resolvedId,
		name: theme.name || "Custom Theme",
		libraryId: theme.libraryId,
		author: theme.author || fallbackTheme.author,
		source,
		description: theme.description,
		primaryHue: clamp(getVal(theme.primaryHue, fallbackTheme.primaryHue), 0, 360),
		primarySat:
			theme.primarySat !== undefined && theme.primarySat !== null
				? clamp(theme.primarySat, 0, 100)
				: undefined,
		primaryLight:
			theme.primaryLight !== undefined && theme.primaryLight !== null
				? clamp(theme.primaryLight, 0, 100)
				: undefined,
		opacity: clamp(getVal(theme.opacity, fallbackTheme.opacity ?? 0), 0, 100),
		grainStrength: clamp(getVal(theme.grainStrength, fallbackTheme.grainStrength ?? 40), 0, 100),
		borderWidth: clamp(getVal(theme.borderWidth, fallbackTheme.borderWidth ?? 1), 0, 6),
		style: normalizeStyleMode(theme.style) || fallbackTheme.style,
		colorScheme: theme.colorScheme || fallbackTheme.colorScheme,
		gradientEnabled: theme.gradientEnabled ?? fallbackTheme.gradientEnabled,
		rotation:
			theme.rotation !== undefined && theme.rotation !== null
				? clamp(theme.rotation, 0, 360)
				: undefined,
		gradientType: theme.gradientType || fallbackTheme.gradientType || "linear",
		gradientHarmony: theme.gradientHarmony || fallbackTheme.gradientHarmony || "none",
		thumbnail: theme.thumbnail,
		customCss: theme.customCss ? sanitizeCustomCss(theme.customCss) : undefined,
		allowHueChange: resolveEditability(theme.allowHueChange, fallbackTheme.allowHueChange),
		allowStyleChange: resolveEditability(theme.allowStyleChange, fallbackTheme.allowStyleChange),
		allowBorderChange: resolveEditability(theme.allowBorderChange, fallbackTheme.allowBorderChange),
		windowEffect: normalizeWindowEffectForCurrentOS(
			theme.windowEffect ||
				(getCurrentOsHint() === "windows"
					? "mica"
					: getCurrentOsHint() === "macos"
						? "vibrancy"
						: "none"),
		),
		backgroundOpacity: theme.backgroundOpacity !== undefined ? theme.backgroundOpacity : 25,
		variables: theme.variables,
		userVariables: normalizeUserVariables(theme.userVariables, theme.variables),
	};
}
