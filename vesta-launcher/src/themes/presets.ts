/**
 * Vesta Launcher Theme System - Preset Definitions
 * 
 * This file contains type-safe theme configurations for built-in and custom themes.
 * Each theme includes complete styling information (hue, style mode, gradient settings).
 */

export type StyleMode = "glass" | "satin" | "flat" | "bordered";
export type GradientHarmony = "none" | "analogous" | "complementary" | "triadic";

export interface ThemeConfig {
	/** Unique theme identifier */
	id: string;
	
	/** Display name shown in UI */
	name: string;
	
	/** Optional description */
	description?: string;
	
	/** Primary hue (0-360) */
	primaryHue: number;
	
	/** Primary saturation (0-100) - advanced mode only */
	primarySat?: number;
	
	/** Primary lightness (0-100) - advanced mode only */
	primaryLight?: number;
	
	/** Visual style mode */
	style: StyleMode;
	
	/** Enable background gradient */
	gradientEnabled: boolean;
	
	/** Gradient angle in degrees (0-360) */
	gradientAngle?: number;
	
	/** Gradient color harmony */
	gradientHarmony?: GradientHarmony;
	
	/** Preview thumbnail URL (optional) */
	thumbnail?: string;

	/** Permissions: whether the theme allows UI customization controls */
	allowHueChange?: boolean; // controls hue slider availability
	allowStyleChange?: boolean; // controls style mode picker availability
	allowBorderChange?: boolean; // controls border thickness slider availability

	/** Optional custom CSS to inject when this theme is active */
	customCss?: string;

	/** Optional default border widths (px) */
	borderWidthSubtle?: number;
	borderWidthStrong?: number;
}

/**
 * Built-in theme presets
 * These are curated themes with pre-tested contrast and accessibility
 */
export const PRESET_THEMES: ThemeConfig[] = [
	{
		id: "midnight",
		name: "Midnight",
		description: "Deep blue glass with gradient - Classic Vesta look",
		primaryHue: 220,
		style: "glass",
		gradientEnabled: true,
		gradientAngle: 135,
		gradientHarmony: "complementary",
		allowHueChange: true,
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "solar",
		name: "Solar",
		description: "Warm orange satin with solid background",
		primaryHue: 40,
		style: "satin",
		gradientEnabled: false,
		allowHueChange: true,
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "neon",
		name: "Neon",
		description: "Electric pink glass with vibrant gradient",
		primaryHue: 300,
		style: "glass",
		gradientEnabled: true,
		gradientAngle: 135,
		gradientHarmony: "complementary",
		allowHueChange: true,
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "classic",
		name: "Classic",
		description: "Clean blue flat theme - Maximum accessibility",
		primaryHue: 210,
		style: "flat",
		gradientEnabled: false,
		allowHueChange: true,
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "forest",
		name: "Forest",
		description: "Natural green with subtle glass effect",
		primaryHue: 140,
		style: "satin",
		gradientEnabled: true,
		gradientAngle: 90,
		gradientHarmony: "analogous",
		allowHueChange: true,
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "sunset",
		name: "Sunset",
		description: "Warm gradient from orange to purple",
		primaryHue: 30,
		style: "glass",
		gradientEnabled: true,
		gradientAngle: 180,
		gradientHarmony: "triadic",
		allowHueChange: true,
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "oldschool",
		name: "Old School",
		description: "Classic design with no transparency and strong borders",
		primaryHue: 210,
		style: "bordered",
		gradientEnabled: false,
		allowHueChange: true,
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
		gradientAngle: 135,
		gradientHarmony: "complementary",
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
	
	return {
		id: theme.id || "custom",
		name: theme.name || "Custom Theme",
		description: theme.description,
		primaryHue: clamp(theme.primaryHue ?? defaultTheme.primaryHue, 0, 360),
		primarySat: theme.primarySat !== undefined ? clamp(theme.primarySat, 0, 100) : undefined,
		primaryLight: theme.primaryLight !== undefined ? clamp(theme.primaryLight, 0, 100) : undefined,
		style: theme.style || defaultTheme.style,
		gradientEnabled: theme.gradientEnabled ?? defaultTheme.gradientEnabled,
		gradientAngle: theme.gradientAngle !== undefined ? clamp(theme.gradientAngle, 0, 360) : undefined,
		gradientHarmony: theme.gradientHarmony || defaultTheme.gradientHarmony,
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
		"--hue-primary": theme.primaryHue.toString(),
		"--gradient-angle": `${theme.gradientAngle || 135}deg`,
		"--gradient-enabled": theme.gradientEnabled ? "1" : "0",
		// Note: --background-opacity is NOT set here so CSS media queries can control it
	};

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
	for (const [key, value] of Object.entries(vars)) {
		style.setProperty(key, value);
	}

	// Ensure background behaves correctly when toggling gradient
	if (theme.gradientEnabled) {
		// Let stylesheet-defined gradient and opacity take over (CSS media queries handle light/dark)
		style.removeProperty("--background-color");
		style.removeProperty("--background-opacity");
	} else {
		// Force solid background
		style.setProperty("--background-color", "var(--surface-base)");
		style.setProperty("--background-opacity", "0");
	}
	
	// Apply style mode attribute
	root.setAttribute("data-style", theme.style);

	// Apply bordered mode (removes blur/transparency, stronger borders)
	if (theme.style === "bordered") {
		root.setAttribute("data-bordered", "true");
	} else {
		root.removeAttribute("data-bordered");
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
	
	// Log for debugging
	console.log(`Theme applied: ${theme.name} (${theme.id})`);
}

/**
 * Utility: Clamp a number between min and max
 */
function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
