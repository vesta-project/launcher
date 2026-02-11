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

export interface ThemeConfig {
	/** Unique theme identifier */
	id: string;
	/** Display name */
	name: string;
	/** Optional description */
	description?: string;
	/** Primary hue (0-360) */
	primaryHue: number;
	/** Optional primary saturation override (0-100) */
	primarySat?: number;
	/** Optional primary lightness override (0-100) */
	primaryLight?: number;
	/** Visual style mode */
	style: StyleMode;
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
	borderWidthSubtle?: number;
	/** Border width for strong borders (px) */
	borderWidthStrong?: number;
	/** Custom CSS to inject when theme is active */
	customCss?: string;
	/** Whether the user can change the hue of this theme */
	allowHueChange?: boolean;
	/** Whether the user can change the style mode of this theme */
	allowStyleChange?: boolean;
	/** Whether the user can change the border thickness of this theme */
	allowBorderChange?: boolean;
}

/**
 * Backend configuration structure for theme-related fields
 */
export interface AppThemeConfig {
	theme_id: string;
	theme_mode?: string;
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
	background_hue?: number; // Legacy/Fallback
}

/**
 * Convert backend config to a full ThemeConfig
 */
export function configToTheme(config: Partial<AppThemeConfig>): ThemeConfig {
	const themeId = config.theme_id || "midnight";
	const baseTheme = getThemeById(themeId) || getDefaultTheme();

	// Helper to get a numeric value that might be 0 (so we can't just use ??)
	const getNum = (val: any) => (typeof val === "number" ? val : undefined);

	return validateTheme({
		...baseTheme,
		primaryHue:
			getNum(config.theme_primary_hue) ??
			getNum(config.background_hue) ??
			baseTheme.primaryHue,
		style: config.theme_style ?? baseTheme.style,
		gradientEnabled: config.theme_gradient_enabled ?? baseTheme.gradientEnabled,
		rotation: getNum(config.theme_gradient_angle) ?? baseTheme.rotation,
		gradientType: config.theme_gradient_type ?? baseTheme.gradientType,
		gradientHarmony: config.theme_gradient_harmony ?? baseTheme.gradientHarmony,
		borderWidthSubtle:
			getNum(config.theme_border_width) ?? baseTheme.borderWidthSubtle,
		borderWidthStrong:
			getNum(config.theme_border_width) !== undefined
				? Math.max((getNum(config.theme_border_width) as number) + 1, 1)
				: baseTheme.borderWidthStrong,
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
		style: "glass",
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
		style: "satin",
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
		style: "glass",
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
		style: "flat",
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
		style: "satin",
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
		style: "glass",
		gradientEnabled: true,
		rotation: 180,
		gradientType: "linear",
		gradientHarmony: "triadic",
		allowHueChange: false, // Locked to signature purple/orange
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "midnight",
		name: "Midnight",
		description: "Ultra-dark Midnight mode — pure black surfaces for true blacks",
		primaryHue: 240, // Dark blue for midnight theme preview
		style: "solid",
		colorScheme: "dark",
		gradientEnabled: false,
		allowHueChange: true, // Allow hue change for accents
		allowStyleChange: false,
		allowBorderChange: false,
		customCss: `:root {
			/* Force truly black surfaces for Midnight panels */
			--surface-base: hsl(0 0% 0%);
			--surface-raised: hsl(0 0% 2%);
			--surface-overlay: hsl(0 0% 3%);
			--surface-sunken: hsl(0 0% 0%);
			--text-primary: hsl(0 0% 100%);
			--text-secondary: hsl(0 0% 70%);
			--text-tertiary: hsl(0 0% 50%);
			--text-disabled: hsl(0 0% 30%);
			/* Use the primary hue for accents, but keep them somewhat muted for Midnight */
			--accent-primary: hsl(var(--color__primary-hue) 50% 50%);
			--accent-primary-hover: hsl(var(--color__primary-hue) 60% 60%);
			--interactive-base: hsl(var(--color__primary-hue) 50% 50%);
			--interactive-hover: hsl(var(--color__primary-hue) 60% 60%);
			--border-subtle: hsl(var(--color__primary-hue) 10% 15% / 0.5);
			--border-strong: hsl(var(--color__primary-hue) 15% 25% / 0.7);
			--border-glass: hsl(var(--color__primary-hue) 10% 20% / 0.3);
			/* Remove all blue/hue tints from liquid glass */
			--liquid-tint-saturation: 0%;
			--liquid-tint-lightness: 0%;
			--liquid-background: hsl(0 0% 0% / var(--liquid-tint-opacity));
			/* Remove all blur effects for performance */
			--liquid-backdrop-filter: none;
			--effect-blur: 0px;
			--glass-blur: none;
			/* Midnight-optimized shadows (minimal to avoid grey halos) */
			--liquid-box-shadow: 0 4px 12px hsl(0 0% 0% / 0.8);
			--effect-shadow-depth: 2px;
		}

		/* Mini-window border for Midnight */
		[class*="page-viewer-root"] {
			border: 1px solid hsl(var(--color__primary-hue) 50% 25% / 0.6);
		}

		[class*="page-viewer-root"]::before {
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
		style: "bordered",
		gradientEnabled: false,
		allowHueChange: true, // Customizable
		allowStyleChange: false,
		allowBorderChange: false,
		borderWidthSubtle: 2,
		borderWidthStrong: 3,
	},
	{
		id: "custom",
		name: "Custom",
		description: "Unlock all controls to craft your own theme",
		primaryHue: 220,
		style: "glass",
		gradientEnabled: true,
		rotation: 135,
		gradientType: "linear",
		gradientHarmony: "none",
		allowHueChange: true,
		allowStyleChange: true,
		allowBorderChange: true,
		borderWidthSubtle: 1,
		borderWidthStrong: 2,
	},
];

/**
 * Get a theme by ID
 */
export function getThemeById(id: string): ThemeConfig | undefined {
	return PRESET_THEMES.find((theme) => theme.id === id);
}

/**
 * Get the default theme
 */
export function getDefaultTheme(): ThemeConfig {
	return PRESET_THEMES[0]; // Midnight
}

/**
 * Validate a custom theme configuration
 * Ensures all values are within safe ranges
 */
export function validateTheme(theme: Partial<ThemeConfig>): ThemeConfig {
	const defaultTheme = getDefaultTheme();

	// Helper to handle null/undefined from backend
	const getVal = <T>(val: T | null | undefined, fallback: T): T =>
		val !== null && val !== undefined ? val : fallback;

	return {
		id: theme.id || "custom",
		name: theme.name || "Custom Theme",
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
		borderWidthSubtle: theme.borderWidthSubtle,
		borderWidthStrong: theme.borderWidthStrong,
		customCss: theme.customCss,
		allowHueChange: theme.allowHueChange,
		allowStyleChange: theme.allowStyleChange,
		allowBorderChange: theme.allowBorderChange,
	};
}

/**
 * Convert theme config to CSS custom properties
 */
export function themeToCSSVars(theme: ThemeConfig): Record<string, string> {
	const vars: Record<string, string> = {
		"--color__primary-hue": theme.primaryHue.toString(),
		"--rotation": `${theme.rotation ?? 135}deg`,
		"--gradient-type": theme.gradientType || "linear",
		"--gradient-enabled": theme.gradientEnabled ? "1" : "0",
		// Note: --background-opacity is NOT set here so CSS media queries can control it
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

	// Border widths: only override when style is bordered (custom thickness)
	if (theme.style === "bordered") {
		if (theme.borderWidthSubtle !== undefined) {
			vars["--border-width-subtle"] = `${theme.borderWidthSubtle}px`;
		}
		if (theme.borderWidthStrong !== undefined) {
			vars["--border-width-strong"] = `${theme.borderWidthStrong}px`;
		}
	} else {
		// Reset to default border widths for other styles
		vars["--border-width-subtle"] = "1px";
		vars["--border-width-strong"] = "1px";
	}

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

	// Skip if theme is already applied (check all relevant fields)
	const currentHue = style.getPropertyValue("--color__primary-hue").trim();
	const currentRotation = style.getPropertyValue("--rotation").trim();
	const currentSecondaryHue = style.getPropertyValue("--hue-secondary").trim();

	if (
		currentHue === theme.primaryHue.toString() &&
		root.getAttribute("data-style") === theme.style &&
		root.getAttribute("data-gradient") ===
			(theme.gradientEnabled ? "1" : "0") &&
		root.getAttribute("data-gradient-type") ===
			(theme.gradientType || "linear") &&
		currentRotation === vars["--rotation"] &&
		currentSecondaryHue === vars["--hue-secondary"]
	) {
		return;
	}

	for (const [key, value] of Object.entries(vars)) {
		style.setProperty(key, value);
	}

	// Ensure background behaves correctly when toggling gradient
	if (theme.gradientEnabled) {
		root.setAttribute("data-gradient", "1");
		// Let stylesheet-defined gradient and opacity take over (CSS media queries handle light/dark)
		style.removeProperty("--background-color");
		style.removeProperty("--background-opacity");
	} else {
		root.setAttribute("data-gradient", "0");
		// Force solid background
		style.setProperty("--background-color", "var(--surface-base)");
		style.setProperty("--background-opacity", "0");
	}

	// Apply style mode attribute
	root.setAttribute("data-style", theme.style);
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

	// Inject or remove custom CSS for this theme
	const tagId = "theme-custom-css";
	let styleTag = document.getElementById(tagId) as HTMLStyleElement | null;
	if (theme.customCss && theme.customCss.trim().length > 0) {
		if (!styleTag) {
			styleTag = document.createElement("style");
			styleTag.id = tagId;
			document.head.appendChild(styleTag);
		}
		styleTag.textContent = theme.customCss;
	} else if (styleTag) {
		styleTag.textContent = "";
	}
}

/**
 * Utility: Clamp a number between min and max
 */
function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
