import { generatePalette } from "../../utils/colorHelpers";
import type { ThemeConfig, GradientHarmony } from "../types";

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

export function getCurrentOsHint(): string {
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

const BUILTIN_WINDOW_EFFECTS = ["none", "vibrancy", "liquid_glass"] as const;
const WINDOWS_WINDOW_EFFECTS = ["none", "mica", "acrylic", "blur"] as const;
const FALLBACK_WINDOW_EFFECT = "none";

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
