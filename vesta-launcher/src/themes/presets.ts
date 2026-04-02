import { generatePalette } from "../utils/colorHelpers";
/**
 * Vesta Launcher Theme System - Preset Definitions
 *
 * This file contains type-safe theme configurations for built-in and custom themes.
 * Each theme includes complete styling information (hue, style mode, gradient settings).
 */

export type StyleMode = "glass" | "satin" | "flat" | "bordered" | "solid";
export type GradientHarmony =
	| "none"
	| "analogous"
	| "complementary"
	| "triadic";

export type ThemeVariableType = "number" | "color" | "boolean" | "select";

interface ThemeVariableBase {
	name: string;
	key: string;
	type: ThemeVariableType;
	description?: string;
}

export interface NumberThemeVariable extends ThemeVariableBase {
	type: "number";
	min: number;
	max: number;
	default: number;
	step?: number;
	unit?: string;
}

export interface ColorThemeVariable extends ThemeVariableBase {
	type: "color";
	default: string;
}

export interface BooleanThemeVariable extends ThemeVariableBase {
	type: "boolean";
	default: boolean;
}

export interface SelectThemeVariable extends ThemeVariableBase {
	type: "select";
	default: string;
	options: Array<{ label: string; value: string }>;
}

export type ThemeVariable =
	| NumberThemeVariable
	| ColorThemeVariable
	| BooleanThemeVariable
	| SelectThemeVariable;

export type ThemeVariableValue = number | string | boolean;
export type ThemeSource = "builtin" | "imported";

export interface ThemeConfig {
	/** Unique theme identifier */
	id: string;
	/** Display name */
	name: string;
	/** Backend library identifier for imported themes */
	libraryId?: string;
	/** Author / Creator */
	author?: string;
	/** Whether this theme is built-in or imported */
	source?: ThemeSource;
	/** Optional description */
	description?: string;
	/** Primary hue (0-360) */
	primaryHue: number;
	/** Optional primary saturation override (0-100) */
	primarySat?: number;
	/** Optional primary lightness override (0-100) */
	primaryLight?: number;
	/** Surface opacity (0 to 100) */
	opacity: number;
	/** Global border width */
	borderWidth?: number;
	/** Legacy style mode */
	style?: StyleMode;
	/** Preferred color scheme */
	colorScheme?: "light" | "dark";
	/** Whether background gradient is enabled */
	gradientEnabled: boolean;
	/** Rotation of the background gradient (0-360) */
	rotation?: number;
	/** Type of gradient to use */
	gradientType?: "linear" | "radial";
	/** Color harmony for the gradient */
	gradientHarmony?: GradientHarmony;
	/** Optional thumbnail image URL */
	thumbnail?: string;
	/** Border width for subtle borders (px) */
	/** Border width for strong borders (px) */
	
	/** Custom CSS to inject when theme is active */
	customCss?: string;
	/** Whether the user can change the hue of this theme */
	allowHueChange?: boolean;
	/** Whether the user can change the style mode of this theme */
	allowStyleChange?: boolean;
	/** Whether the user can change the border thickness of this theme */
	allowBorderChange?: boolean;
        windowEffect?: string;
        backgroundOpacity?: number;
	variables?: ThemeVariable[];
	userVariables?: Record<string, ThemeVariableValue>;
}

/**
 * Backend configuration structure for theme-related fields
 */
export interface AppThemeConfig {
	theme_id: string;
	theme_mode?: string;
	theme_data?: string; // Merged JSON (author, params, variables)
	theme_primary_hue: number;
	theme_primary_sat?: number;
	theme_primary_light?: number;
	theme_style: StyleMode;
	theme_gradient_enabled: boolean;
	theme_gradient_angle?: number;
	theme_gradient_type?: "linear" | "radial";
	theme_gradient_harmony?: GradientHarmony;
	theme_advanced_overrides?: string;
	theme_border_width?: number;
    theme_window_effect?: string;
    theme_background_opacity?: number;
	background_hue?: number; // Legacy/Fallback
}

export interface ThemeDataPayload {
	id?: string;
	name?: string;
	author?: string;
	description?: string;
	primaryHue?: number;
	primarySat?: number;
	primaryLight?: number;
	opacity?: number;
	style?: StyleMode;
	gradientEnabled?: boolean;
	rotation?: number;
	gradientType?: "linear" | "radial";
	gradientHarmony?: GradientHarmony;
	borderWidth?: number;
	backgroundOpacity?: number;
	windowEffect?: string;
	customCss?: string;
	variables?: ThemeVariable[];
	userVariables?: Record<string, ThemeVariableValue>;
}

const customThemeRegistry = new Map<string, ThemeConfig>();

const BUILTIN_WINDOW_EFFECTS = ["none", "vibrancy", "liquid_glass"] as const;
const WINDOWS_WINDOW_EFFECTS = ["none", "mica", "acrylic", "blur"] as const;
const FALLBACK_WINDOW_EFFECT = "none";

function getCurrentOsHint(): string {
	if (typeof document !== "undefined") {
		const attr = document.documentElement.getAttribute("data-os");
		if (attr && attr.trim().length > 0) {
			return attr.trim().toLowerCase();
		}
	}

	if (typeof window !== "undefined") {
		const hinted = (window as any).__VESTA_OS__;
		if (typeof hinted === "string" && hinted.trim().length > 0) {
			return hinted.trim().toLowerCase();
		}
	}

	return "";
}

export function getSupportedWindowEffects(osHint?: string): string[] {
	const os = (osHint || getCurrentOsHint()).toLowerCase();
	if (os === "macos") {
		return [...BUILTIN_WINDOW_EFFECTS];
	}
	if (os === "windows") {
		return [...WINDOWS_WINDOW_EFFECTS];
	}
	return [FALLBACK_WINDOW_EFFECT];
}

export function normalizeWindowEffectForCurrentOS(effect?: string, osHint?: string): string {
	const requested = (effect || "").trim().toLowerCase();
	if (!requested) return FALLBACK_WINDOW_EFFECT;

	const supported = getSupportedWindowEffects(osHint);
	return supported.includes(requested) ? requested : FALLBACK_WINDOW_EFFECT;
}

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

function parseUserVariables(value: unknown): Record<string, ThemeVariableValue> | undefined {
	if (!isObjectLike(value)) return undefined;

	const parsed: Record<string, ThemeVariableValue> = {};
	for (const [key, val] of Object.entries(value)) {
		if (typeof val === "number" || typeof val === "string" || typeof val === "boolean") {
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
	out.gradientEnabled = getBoolean(source.gradientEnabled ?? source.gradient_enabled);
	out.rotation = getNumber(source.rotation);
	out.gradientType = getString(source.gradientType ?? source.gradient_type) as
		| "linear"
		| "radial"
		| undefined;
	out.gradientHarmony = getString(source.gradientHarmony ?? source.gradient_harmony) as GradientHarmony | undefined;
	out.borderWidth = getNumber(source.borderWidth ?? source.border_width);
	out.backgroundOpacity = getNumber(source.backgroundOpacity ?? source.background_opacity);
	out.windowEffect = getString(source.windowEffect ?? source.window_effect);
	out.customCss = getString(source.customCss ?? source.custom_css);
	out.variables = parseVariableDefinitions(source.variables ?? source.params);
	out.userVariables = parseUserVariables(
		source.userVariables ?? source.user_variables ?? source.userParams ?? source.user_params,
	);

	return out;
}

export function serializeThemeData(payload: ThemeDataPayload): string {
	return JSON.stringify(payload);
}

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
			baseTheme.primaryHue ?? 180,
		opacity: getNum(themeData.opacity) ?? baseTheme.opacity ?? 0,
		borderWidth: themeData.borderWidth ?? config.theme_border_width ?? baseTheme.borderWidth,
		style: themeData.style ?? config.theme_style ?? baseTheme.style,
		gradientEnabled: themeData.gradientEnabled ?? config.theme_gradient_enabled ?? baseTheme.gradientEnabled,
		rotation: getNum(themeData.rotation) ?? getNum(config.theme_gradient_angle) ?? baseTheme.rotation,
		gradientType: themeData.gradientType ?? config.theme_gradient_type ?? baseTheme.gradientType,
		gradientHarmony: themeData.gradientHarmony ?? config.theme_gradient_harmony ?? baseTheme.gradientHarmony,
		customCss: (themeData.customCss && themeData.customCss.trim().length > 0)
			? themeData.customCss
			: (config.theme_advanced_overrides && config.theme_advanced_overrides.trim().length > 0)
				? config.theme_advanced_overrides
				: baseTheme.customCss,
		windowEffect: themeData.windowEffect ?? config.theme_window_effect ?? baseTheme.windowEffect,
		backgroundOpacity: themeData.backgroundOpacity ?? config.theme_background_opacity ?? baseTheme.backgroundOpacity,
		author: themeData.author ?? baseTheme.author,
		variables: themeData.variables ?? baseTheme.variables,
		userVariables: themeData.userVariables,
	});
}

/**
 * Built-in theme presets
 * These are curated themes with pre-tested contrast and accessibility
 */
export const PRESET_THEMES: ThemeConfig[] = [
	{
		id: "vesta",
		name: "Vesta",
		description: "Signature teal to purple to orange gradient",
		primaryHue: 180,
		opacity: 0, borderWidth: 1, style: "glass",
		gradientEnabled: true,
		rotation: 180,
		gradientType: "linear",
		gradientHarmony: "triadic",
		customCss: `
			:root {
				--theme-bg-gradient: linear-gradient(180deg, hsl(180 100% 50%), hsl(280 100% 25%), hsl(35 100% 50%));
			}
		`,
		allowHueChange: false, // Locked to signature colors
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "solar",
		name: "Solar",
		description: "Signature warm orange satin with solid background",
		primaryHue: 40,
		opacity: 50, borderWidth: 1, style: "satin",
		gradientEnabled: false,
		allowHueChange: false, // Locked to signature orange
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "neon",
		name: "Neon",
		description: "Signature electric pink glass with vibrant gradient",
		primaryHue: 300,
		opacity: 0, borderWidth: 1, style: "glass",
		gradientEnabled: true,
		rotation: 135,
		gradientType: "linear",
		gradientHarmony: "complementary",
		allowHueChange: false, // Locked to signature pink
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "classic",
		name: "Classic",
		description: "Clean customizable theme - Maximum accessibility",
		primaryHue: 210,
		opacity: 100, borderWidth: 1, style: "flat",
		gradientEnabled: false,
		allowHueChange: true, // Customizable
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "forest",
		name: "Forest",
		description: "Signature natural green with subtle glass effect",
		primaryHue: 140,
		opacity: 50, borderWidth: 1, style: "satin",
		gradientEnabled: true,
		rotation: 90,
		gradientType: "linear",
		gradientHarmony: "analogous",
		allowHueChange: false, // Locked to signature green
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "sunset",
		name: "Sunset",
		description: "Signature warm gradient from purple to orange",
		primaryHue: 270,
		opacity: 0, borderWidth: 1, style: "glass",
		gradientEnabled: true,
		rotation: 180,
		gradientType: "linear",
		gradientHarmony: "triadic",
		allowHueChange: false, // Locked to signature purple/orange
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "prism",
		name: "Prism",
		description: "Technicolor glass with reactive variables",
		author: "Vesta Team",
		primaryHue: 200,
		opacity: 20,
		borderWidth: 1,
		style: "glass",
		gradientEnabled: true,
		rotation: 45,
		gradientType: "linear",
		gradientHarmony: "triadic",
		allowHueChange: true,
		allowStyleChange: false,
		allowBorderChange: false,
		variables: [
			{
				name: "Glow Intensity",
				key: "glow-intensity",
				type: "number",
				min: 0,
				max: 100,
				default: 50,
				unit: "%",
			},
			{
				name: "Glass Blur",
				key: "glass-blur",
				type: "number",
				min: 0,
				max: 40,
				default: 12,
				unit: "px",
			},
			{
				name: "Edge Sharpness",
				key: "edge-sharpness",
				type: "number",
				min: 0,
				max: 100,
				default: 50,
				unit: "%",
			},
		],
		customCss: `
			:root {
				--effect-glow-strength: calc(var(--theme-var-glow-intensity) / 100);
				--glass-blur-radius: calc(var(--theme-var-glass-blur) * 1px);
				--border-opacity: calc(var(--theme-var-edge-sharpness) / 100);

				--liquid-backdrop-filter: blur(var(--glass-blur-radius)) saturate(1.5);
				--effect-blur: var(--glass-blur-radius);
				--effect-shadow: 0 8px 32px 0 rgba(var(--primary-base), calc(0.3 * var(--effect-glow-strength)));
				--border-glass: hsl(var(--color__primary-hue) 100% 100% / var(--border-opacity));
				--background-opacity: 0.15;
			}
		`,
	},
	{
		id: "midnight",
		name: "Midnight",
		description:
			"Ultra-dark Midnight mode — pure black surfaces for true blacks",
		primaryHue: 240, // Dark blue for midnight theme preview
		opacity: 100, borderWidth: 0, style: "solid",
		colorScheme: "dark",
		gradientEnabled: false,
		allowHueChange: true, // Allow hue change for accents
		allowStyleChange: false,
		allowBorderChange: false,
		customCss: `:root {
			/* Force truly black surfaces for Midnight panels using the computed variables */
			--surface-base-computed: hsl(0 0% 0%);
			--surface-raised-computed: hsl(0 0% 2%);
			--surface-overlay-computed: hsl(0 0% 3%);
			--surface-sunken-computed: hsl(0 0% 0%);

			/* Midnight palette overrides */
			--text-primary: hsl(0 0% 100%);
			--text-secondary: hsl(0 0% 70%);
			--text-tertiary: hsl(0 0% 50%);
			--text-disabled: hsl(0 0% 30%);

			/* Accent mapping (Primary hue is maintained from config) */
			--accent-primary: hsl(var(--color__primary-hue) 50% 50%);
			--accent-primary-hover: hsl(var(--color__primary-hue) 60% 60%);
			--interactive-base: hsl(var(--color__primary-hue) 50% 50%);
			--interactive-hover: hsl(var(--color__primary-hue) 60% 60%);

			/* Refined borders for true black look */
			--border-subtle: hsl(var(--color__primary-hue) 10% 15% / 0.5);
			--border-strong: hsl(var(--color__primary-hue) 15% 25% / 0.7);
			--border-glass: hsl(var(--color__primary-hue) 10% 20% / 0.3);

			/* Liquid glass adjustments for Midnight */
			--liquid-tint-saturation: 0%;
			--liquid-tint-lightness: 0%;
			--liquid-background: hsl(0 0% 0% / var(--liquid-tint-opacity));
			--liquid-backdrop-filter: none;
			--effect-blur: 0px;
			--glass-blur: none;

			/* Midnight-optimized shadows */
			--liquid-box-shadow: 0 4px 12px hsl(0 0% 0% / 0.8);
			--effect-shadow: 0 12px 40px rgba(0, 0, 0, 0.9);
			--effect-shadow-depth: 2px;
		}

			/* Specific Midnight styling for containers */
			[class*="page-viewer-root"],
			[data-popper-positioner] > div {
				border: 1px solid hsl(var(--color__primary-hue) 50% 25% / 0.6) !important;
				position: relative;
			}

			[class*="page-viewer-root"]::before,
			[data-popper-positioner] > div::before {
				content: "";
				position: absolute;
				inset: 0;
				border-radius: inherit;
				border: 1px solid hsl(var(--color__primary-hue) 50% 40% / 0.1);
				pointer-events: none;
			}
		`,
	},
	{
		id: "oldschool",
		name: "Old School",
		description: "Classic customizable design with strong borders",
		primaryHue: 210,
		opacity: 100, borderWidth: 2, style: "bordered",
		gradientEnabled: false,
		allowHueChange: true, // Customizable
		allowStyleChange: false,
		allowBorderChange: false,
		
	},
	{
		id: "custom",
		name: "Custom",
		description: "Unlock all controls to craft your own theme",
		primaryHue: 220,
		opacity: 0, borderWidth: 1, style: "glass",
		gradientEnabled: true,
		rotation: 135,
		gradientType: "linear",
		gradientHarmony: "none",
		allowHueChange: true,
		allowStyleChange: true,
		allowBorderChange: true,
		
	},
];

/**
 * Get a theme by ID
 */
export function getThemeById(id: string): ThemeConfig | undefined {
	return customThemeRegistry.get(id) || PRESET_THEMES.find((theme) => theme.id === id);
}

export function isBuiltinThemeId(id: string): boolean {
	return PRESET_THEMES.some((theme) => theme.id === id);
}

/**
 * Get the default theme
 */
export function getDefaultTheme(): ThemeConfig {
	return PRESET_THEMES[0]; // Vesta is the default theme
}

/**
 * Validate a custom theme configuration
 * Ensures all values are within safe ranges
 */

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

function normalizeUserVariables(
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
			normalized[variable.key] =
				typeof candidate === "boolean" ? candidate : variable.default;
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
		borderWidth: clamp(getVal(theme.borderWidth, defaultTheme.borderWidth ?? 1), 0, 10),
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
		// Pass-through extras for runtime application
		
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
		backgroundOpacity: theme.backgroundOpacity !== undefined ? theme.backgroundOpacity : 25,
		variables: theme.variables,
		userVariables: normalizeUserVariables(theme.userVariables, theme.variables),
	};
}

/**
 * Convert theme config to CSS custom properties
 */
export function themeToCSSVars(theme: ThemeConfig): Record<string, string> {
	const vars: Record<string, string> = {
		"--color__primary-hue": theme.primaryHue.toString(),
		"--background-opacity":
			(theme.backgroundOpacity !== undefined
				? (theme.backgroundOpacity / 100).toFixed(2)
				: "0.25"),
		"--rotation": `${theme.rotation ?? 135}deg`,
		"--gradient-type": theme.gradientType || "linear",
		"--gradient-enabled": theme.gradientEnabled ? "1" : "0",
	};
	// Calculate harmony hues
	const primary = theme.primaryHue;
	let secondary = primary;
	let accent = primary + 30; // Default analogous-ish accent

	switch (theme.gradientHarmony) {
		case "analogous":
			secondary = (primary + 30) % 360;
			accent = (primary - 30 + 360) % 360;
			break;
		case "complementary":
			secondary = (primary + 180) % 360;
			accent = (primary + 30) % 360;
			break;
		case "triadic":
			secondary = (primary + 120) % 360;
			accent = (primary + 240) % 360;
			break;
		case "none":
		default:
			secondary = primary;
			accent = primary;
			break;
	}

	vars["--hue-secondary"] = secondary.toString();
	vars["--hue-accent"] = accent.toString();

	const s = theme.primarySat ?? 100;
	const l = theme.primaryLight ?? 50;

	const primaryPalette = generatePalette({ h: primary, s, l });
	const secondaryPalette = generatePalette({ h: secondary, s, l });
	const accentPalette = generatePalette({ h: accent, s, l });

	vars["--primary-base"] = primaryPalette.base;
	vars["--primary-hover"] = primaryPalette.hover;
	vars["--primary-active"] = primaryPalette.active;
	vars["--primary-transparent"] = primaryPalette.transparent;
	vars["--primary-low"] = primaryPalette.low;
	vars["--text-on-primary"] = primaryPalette.textOnPrimary;

	vars["--secondary-base"] = secondaryPalette.base;
	vars["--secondary-hover"] = secondaryPalette.hover;
	vars["--secondary-active"] = secondaryPalette.active;
	vars["--secondary-transparent"] = secondaryPalette.transparent;
	vars["--secondary-low"] = secondaryPalette.low;
	vars["--text-on-secondary"] = secondaryPalette.textOnPrimary;

	vars["--accent-base"] = accentPalette.base;
	vars["--accent-hover"] = accentPalette.hover;
	vars["--accent-active"] = accentPalette.active;
	vars["--accent-transparent"] = accentPalette.transparent;
	vars["--accent-low"] = accentPalette.low;
	vars["--text-on-accent"] = accentPalette.textOnPrimary;

	// Skip default glass calculation for specific styles that handle it via custom CSS or fixed modes (like Midnight/Old School)
	if (theme.style !== "solid" && theme.style !== "bordered") {
		const opacityValue = theme.opacity ?? 0;
		// Map opacity 0 -> 100 to blur and alpha
		// 0 opacity = 20px blur, 0.5 alpha
		// 100 opacity = 0px blur, 1.0 alpha
		const effectOpacity = 0.5 + (opacityValue / 100) * 0.5;
		const blurPx = 20 - (opacityValue / 100) * 20;

		vars["--effect-opacity"] = effectOpacity.toString();
		vars["--effect-blur"] = `${blurPx}px`;
		vars["--liquid-frost-blur"] = `${blurPx * 0.8}px`;

		if (blurPx > 0) {
			vars["--liquid-backdrop-filter"] = `blur(${blurPx}px) saturate(${1.5 - (opacityValue/100)*0.5})`;
		} else {
			vars["--liquid-backdrop-filter"] = "none";
		}
	} else {
		// Reset to standard solid/opaque values for Solid and Bordered styles
		vars["--effect-opacity"] = "1.0";
		vars["--effect-blur"] = "0px";
		vars["--liquid-frost-blur"] = "0px";
		vars["--liquid-backdrop-filter"] = "none";
	}

	// Border width scaling
	const bdWidth = theme.borderWidth ?? 1;
	vars["--border-width-subtle"] = `${bdWidth}px`;
	vars["--border-width-strong"] = `${bdWidth + 1}px`;

	// When gradients are disabled, force a flat background to avoid residual tints
	if (!theme.gradientEnabled) {
		vars["--background-color"] = "var(--surface-base)";
	}

	// Advanced mode overrides
	if (theme.primarySat !== undefined) {
		vars["--primary-saturation"] = `${theme.primarySat}%`;
	}
	if (theme.primaryLight !== undefined) {
		vars["--primary-lightness"] = `${theme.primaryLight}%`;
	}

	// Apply custom theme variables
	if (theme.userVariables) {
		for (const [key, val] of Object.entries(theme.userVariables)) {
			vars[`--theme-var-${key}`] =
				typeof val === "boolean" ? (val ? "1" : "0") : String(val);
		}
	}

	// Also ensure variables from the theme definition have defaults if not in userVariables
	if (theme.variables) {
		for (const v of theme.variables) {
			const key = `--theme-var-${v.key}`;
			if (!vars[key]) {
				vars[key] = typeof v.default === "boolean" ? (v.default ? "1" : "0") : String(v.default);
			}
		}
	}

	return vars;
}

/**
 * Apply theme to document root
 */
export function applyTheme(theme: ThemeConfig): void {
	const root = document.documentElement;
	const style = root.style;

	// Apply CSS variables
	const vars = themeToCSSVars(theme);

	// Multi-criteria identity check for the theme
	const themeId = theme.id;
	const currentThemeId = root.getAttribute("data-theme-id");

	// Skip if theme is already applied (check all relevant fields)
	const currentHue = style.getPropertyValue("--color__primary-hue").trim();
	const currentRotation = style.getPropertyValue("--rotation").trim();
	const currentSecondaryHue = style.getPropertyValue("--hue-secondary").trim();
	const currentBackgroundOpacity = style.getPropertyValue("--background-opacity").trim();
	const currentOpacity = style.getPropertyValue("--effect-opacity").trim();
	const currentWindowEffect = root.getAttribute("data-window-effect") || "none";
	const currentBorderWidth = style.getPropertyValue("--border-width-subtle").trim();
	const nextThemeVarKeys = Object.keys(vars).filter((key) => key.startsWith("--theme-var-"));
	const previousThemeVarKeys = (root.getAttribute("data-theme-var-keys") || "")
		.split(",")
		.map((key) => key.trim())
		.filter((key) => key.length > 0);
	const hasRemovedThemeVars = previousThemeVarKeys.some((key) => !nextThemeVarKeys.includes(key));

	const styleTag = document.getElementById("theme-custom-css") as HTMLStyleElement | null;
	const currentCustomCss = (styleTag?.textContent || "").trim();
	const nextCustomCss = (theme.customCss || "").trim();
	const customCssChanged = currentCustomCss !== nextCustomCss;

	const updateCustomCss = (t: ThemeConfig) => {
		const tagId = "theme-custom-css";
		let styleTag = document.getElementById(tagId) as HTMLStyleElement | null;
		const normalizedCss = (t.customCss || "").trim();

		if (normalizedCss.length > 0) {
			if (!styleTag) {
				styleTag = document.createElement("style");
				styleTag.id = tagId;
				document.head.appendChild(styleTag);
			}
			if (styleTag.textContent !== normalizedCss) {
				styleTag.textContent = normalizedCss;
			}
		} else if (styleTag && styleTag.textContent !== "") {
			styleTag.textContent = "";
		}
	};

	// Helper for numeric string comparison with epsilon
	const numMatch = (a: string, b: string) => {
		if (!a || !b) return a === b;
		const na = parseFloat(a);
		const nb = parseFloat(b);
		if (isNaN(na) || isNaN(nb)) return a === b;
		return Math.abs(na - nb) < 0.005;
	};

	// Force update if the root attribute hasn't been set yet (prevents "pre-initialized" skip)
	const isFirstApply = !currentThemeId;

	if (
		!isFirstApply &&
		currentThemeId === themeId &&
		currentHue === theme.primaryHue.toString() &&
		root.getAttribute("data-style") === theme.style &&
		root.getAttribute("data-gradient") ===
			(theme.gradientEnabled ? "1" : "0") &&
		root.getAttribute("data-gradient-type") ===
			(theme.gradientType || "linear") &&
		currentRotation === vars["--rotation"] &&
		currentSecondaryHue === vars["--hue-secondary"] &&
		numMatch(currentBackgroundOpacity, vars["--background-opacity"]) &&
		numMatch(currentOpacity, vars["--effect-opacity"]) &&
		currentWindowEffect === (theme.windowEffect || "none") &&
		currentBorderWidth === vars["--border-width-subtle"]
	) {
		const anyVarChanged = nextThemeVarKeys.some(
			(key) => {
				const current = style.getPropertyValue(key).trim();
				const next = vars[key];
				return current !== next;
			}
		);

		if (!anyVarChanged && !hasRemovedThemeVars && !customCssChanged) {
			updateCustomCss(theme);
			return;
		}
	}

        for (const staleKey of previousThemeVarKeys) {
                if (!nextThemeVarKeys.includes(staleKey)) {
                        style.removeProperty(staleKey);
                }
        }

        for (const [key, value] of Object.entries(vars)) {
                if (style.getPropertyValue(key).trim() !== value) {
                        style.setProperty(key, value);
                }
        }

        updateCustomCss(theme);
        root.setAttribute("data-theme-id", themeId);
        root.setAttribute("data-theme-var-keys", nextThemeVarKeys.join(","));

        const effectToSet = theme.windowEffect || "none";
        if (currentWindowEffect !== effectToSet) {
                root.setAttribute("data-window-effect", effectToSet);
                if ((window as any).__TAURI_INTERNALS__) {
                        import("@tauri-apps/api/core").then(({ invoke }) => {
                                invoke("set_window_effect", { effect: effectToSet }).catch(console.error);
                        });
                }
        }

	// Ensure background behaves correctly when toggling gradient
	if (theme.gradientEnabled) {
		root.setAttribute("data-gradient", "1");
		// Let stylesheet-defined gradient and opacity take over (CSS media queries handle light/dark)
		style.removeProperty("--background-color");
		
	} else {
		root.setAttribute("data-gradient", "0");
		// Force solid background
		style.setProperty("--background-color", "var(--surface-base)");
		
	}

	// Apply style mode attribute
	root.setAttribute("data-style", theme.style ?? "solid");
	root.setAttribute("data-gradient-type", theme.gradientType || "linear");

	// Apply color scheme attribute (forces dark/light mode regardless of system)
	if (theme.colorScheme) {
		root.setAttribute("data-theme", theme.colorScheme);
	} else {
		root.removeAttribute("data-theme");
	}

	// Apply bordered mode (removes blur/transparency, stronger borders)
	if (theme.style === "bordered") {
		root.setAttribute("data-bordered", "true");
	} else {
		root.removeAttribute("data-bordered");
	}

	// Apply solid mode (100% opacity, no blur)
	if (theme.style === "solid") {
		root.setAttribute("data-solid", "true");
	} else {
		root.removeAttribute("data-solid");
	}
}

/**
 * Utility: Clamp a number between min and max
 */
function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
