import type {
	StyleMode,
	ThemeConfig,
	ThemeDataPayload,
	ThemeVariable,
	ThemeVariableType,
	ThemeVariableValue,
} from "../types";
import {
	getCurrentOsHint,
	normalizeWindowEffectForCurrentOS,
} from "./themeToCSSVars";

function isObjectLike(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function getBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		if (value === "true" || value === "1") return true;
		if (value === "false" || value === "0") return false;
	}
	return undefined;
}

function getString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseVariableDefinitions(value: unknown): ThemeVariable[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const parsed: ThemeVariable[] = [];
	for (const entry of value) {
		if (!isObjectLike(entry)) continue;

		const name = getString(entry.name);
		const key = getString(entry.key);
		const type = getString(entry.type) as ThemeVariableType | undefined;
		if (!name || !key || !type) continue;

		if (type === "number") {
			const min = getNumber(entry.min);
			const max = getNumber(entry.max);
			const def = getNumber(entry.default);
			if (min === undefined || max === undefined || def === undefined) continue;
			parsed.push({
				name,
				key,
				type,
				min,
				max,
				default: def,
				step: getNumber(entry.step),
				unit: getString(entry.unit),
				description: getString(entry.description),
			});
			continue;
		}

		if (type === "color") {
			const def = getString(entry.default);
			if (!def) continue;
			parsed.push({
				name,
				key,
				type,
				default: def,
				description: getString(entry.description),
			});
			continue;
		}

		if (type === "boolean") {
			const def = getBoolean(entry.default);
			if (def === undefined) continue;
			parsed.push({
				name,
				key,
				type,
				default: def,
				description: getString(entry.description),
			});
			continue;
		}

		if (type === "select") {
			const def = getString(entry.default);
			if (!def || !Array.isArray(entry.options)) continue;
			const options = entry.options
				.filter((opt): opt is Record<string, unknown> => isObjectLike(opt))
				.map((opt) => ({
					label: getString(opt.label) || getString(opt.value) || "Option",
					value: getString(opt.value) || "",
				}))
				.filter((opt) => opt.value.length > 0);
			if (options.length === 0) continue;
			parsed.push({
				name,
				key,
				type,
				default: def,
				options,
				description: getString(entry.description),
			});
		}
	}

	return parsed.length > 0 ? parsed : undefined;
}

function parseUserVariables(
	value: unknown,
): Record<string, ThemeVariableValue> | undefined {
	if (!isObjectLike(value)) return undefined;

	const parsed: Record<string, ThemeVariableValue> = {};
	for (const [key, val] of Object.entries(value)) {
		if (
			typeof val === "number" ||
			typeof val === "string" ||
			typeof val === "boolean"
		) {
			parsed[key] = val;
		}
	}

	return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function parseThemeData(raw: unknown): Partial<ThemeDataPayload> {
	let source: unknown = raw;
	if (typeof raw === "string") {
		try {
			source = JSON.parse(raw);
		} catch (e) {
			console.error("Failed to parse theme_data JSON:", e);
			return {};
		}
	}

	if (!isObjectLike(source)) return {};

	const out: Partial<ThemeDataPayload> = {};
	out.id = getString(source.id);
	out.name = getString(source.name);
	out.author = getString(source.author);
	out.description = getString(source.description);
	out.primaryHue = getNumber(source.primaryHue ?? source.primary_hue);
	out.primarySat = getNumber(source.primarySat ?? source.primary_sat);
	out.primaryLight = getNumber(source.primaryLight ?? source.primary_light);
	out.opacity = getNumber(source.opacity);
	out.style = getString(source.style) as StyleMode | undefined;
	out.gradientEnabled = getBoolean(
		source.gradientEnabled ?? source.gradient_enabled,
	);
	out.rotation = getNumber(source.rotation);
	out.gradientType = getString(source.gradientType ?? source.gradient_type) as
		| "linear"
		| "radial"
		| undefined;
	out.gradientHarmony = getString(
		source.gradientHarmony ?? source.gradient_harmony,
	) as any;
	out.borderWidth = getNumber(source.borderWidth ?? source.border_width);
	out.backgroundOpacity = getNumber(
		source.backgroundOpacity ?? source.background_opacity,
	);
	out.windowEffect = getString(source.windowEffect ?? source.window_effect);
	out.customCss = getString(source.customCss ?? source.custom_css);
	out.variables = parseVariableDefinitions(source.variables ?? source.params);
	out.userVariables = parseUserVariables(
		source.userVariables ??
			source.user_variables ??
			source.userParams ??
			source.user_params,
	);

	return out;
}

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

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function normalizeUserVariables(
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

export function validateTheme(
	theme: Partial<ThemeConfig>,
	defaultTheme: ThemeConfig,
	isBuiltinThemeCheck: (id: string) => boolean,
): ThemeConfig {
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
			(isBuiltinThemeCheck(theme.id || "custom") ? "builtin" : "imported"),
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
