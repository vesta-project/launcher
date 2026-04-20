import { generatePalette } from "../../utils/colorHelpers";
import type { ThemeConfig } from "../types";

/**
 * Convert theme config to CSS custom properties
 */
export function themeToCSSVars(theme: ThemeConfig): Record<string, string> {
	const vars: Record<string, string> = {
		"--color__primary-hue": theme.primaryHue.toString(),
		"--background-opacity":
			theme.backgroundOpacity !== undefined ? (theme.backgroundOpacity / 100).toFixed(2) : "0.25",
		"--rotation": `${theme.rotation ?? 135}deg`,
		"--gradient-type": theme.gradientType || "linear",
		"--gradient-enabled": theme.gradientEnabled ? "1" : "0",
	};

	// Calculate harmony hues
	const primary = theme.primaryHue;
	let secondary: number;
	let accent: number; // Default analogous-ish accent

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

	const style = theme.style ?? "glass";
	const opacityValue = theme.opacity ?? 0;

	if (style === "flat") {
		vars["--effect-opacity"] = "1.0";
		vars["--effect-blur"] = "0px";
		vars["--liquid-frost-blur"] = "0px";
		vars["--liquid-backdrop-filter"] = "none";
		vars["--liquid-backdrop-filter-subtle"] = "none";
	} else if (style === "frosted") {
		// Frosted should stay diffused, but still reveal the root gradient behind major panels.
		const effectOpacity = 0.64 + (opacityValue / 100) * 0.24;
		const blurPx = 22 - (opacityValue / 100) * 12;
		const subtleBlurPx = blurPx * 0.56;

		vars["--effect-opacity"] = effectOpacity.toFixed(3);
		vars["--effect-blur"] = `${blurPx.toFixed(2)}px`;
		vars["--liquid-frost-blur"] = `${(blurPx * 1.04).toFixed(2)}px`;
		vars["--liquid-backdrop-filter"] =
			`blur(${blurPx.toFixed(2)}px) saturate(${(1.09 - (opacityValue / 100) * 0.14).toFixed(3)})`;
		vars["--liquid-backdrop-filter-subtle"] =
			`blur(${subtleBlurPx.toFixed(2)}px) saturate(${(1.05 - (opacityValue / 100) * 0.08).toFixed(3)})`;
	} else {
		const effectOpacity = 0.5 + (opacityValue / 100) * 0.5;
		const blurPx = 24 - (opacityValue / 100) * 18;
		const subtleBlurPx = blurPx * 0.52;

		vars["--effect-opacity"] = effectOpacity.toFixed(3);
		vars["--effect-blur"] = `${blurPx.toFixed(2)}px`;
		vars["--liquid-frost-blur"] = `${(blurPx * 0.8).toFixed(2)}px`;
		vars["--liquid-backdrop-filter"] =
			`blur(${blurPx.toFixed(2)}px) saturate(${(1.45 - (opacityValue / 100) * 0.45).toFixed(3)})`;
		vars["--liquid-backdrop-filter-subtle"] =
			`blur(${subtleBlurPx.toFixed(2)}px) saturate(${(1.22 - (opacityValue / 100) * 0.32).toFixed(3)})`;
	}

	const defaultGrain = style === "frosted" ? 62 : style === "glass" ? 34 : 0;
	const grainStrength = Math.max(0, Math.min(100, theme.grainStrength ?? defaultGrain));
	const normalizedGrain = grainStrength / 100;
	const grainOpacity =
		style === "flat"
			? 0
			: style === "frosted"
				? Math.min(1, 0.03 + Math.pow(normalizedGrain, 4.5) * 0.97)
				: Math.min(1, 0.02 + Math.pow(normalizedGrain, 5) * 0.98);
	const grainTileSize =
		style === "flat"
			? 196
			: style === "frosted"
				? 176 - normalizedGrain * 52
				: 188 - normalizedGrain * 56;

	vars["--liquid-noise-opacity"] = `${grainOpacity.toFixed(3)}`;
	vars["--liquid-noise-size"] = `${grainTileSize.toFixed(0)}px ${grainTileSize.toFixed(0)}px`;

	// Border width scaling
	const bdWidth = theme.borderWidth ?? 1;
	const clampedBorderWidth = Math.max(0, Math.min(6, bdWidth));
	vars["--border-width-subtle"] = `${clampedBorderWidth}px`;
	vars["--border-width-strong"] = `${Math.min(6, clampedBorderWidth + 1)}px`;
	vars["--border-width-divider"] = `${Math.max(1, clampedBorderWidth)}px`;
	vars["--button-border-width"] = `${Math.max(1, clampedBorderWidth)}px`;

	// Gradient on/off background switching is handled in applyTheme() to avoid stale inline states.

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
			vars[`--theme-var-${key}`] = typeof val === "boolean" ? (val ? "1" : "0") : String(val);
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
