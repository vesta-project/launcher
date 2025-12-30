import { invoke } from "@tauri-apps/api/core";
import { JSX } from "solid-js";
import { getThemeById, getDefaultTheme, applyTheme, validateTheme, type ThemeConfig } from "../themes/presets";

interface AppConfig {
	debug_logging: boolean;
	background_hue: number; // Legacy field - migrated to theme_id
	theme_id?: string;
	theme_style?: string;
	theme_gradient_enabled?: boolean;
	[key: string]: any;
}

/**
 * Initialize theme system from config
 * Handles migration from legacy background_hue to new theme system
 */
export async function initTheme() {
	const root = document.documentElement;
	const style = root.style;

	// Set font sizes (TODO: These should become tokens in next phase)
	style.setProperty("--font-xxsmall", "0.75rem");
	style.setProperty("--font-xsmall", "0.85rem");
	style.setProperty("--font-small", "1rem");
	style.setProperty("--font-medium", "1.25rem");
	style.setProperty("--font-large", "2rem");
	style.setProperty("--font-xlarge", "4rem");

	// Load theme configuration and only apply if config specifies one.
	try {
		const config = await invoke<AppConfig>("get_config");
		let theme: ThemeConfig | null = null;

		// Prefer explicit theme_id
		if (config.theme_id) {
			const presetTheme = getThemeById(config.theme_id);
			if (presetTheme) {
				theme = presetTheme;
				console.info(`Theme loaded from preset: ${theme.name} (${theme.id})`);
			} else {
				console.warn(`Unknown theme ID "${config.theme_id}", skipping apply`);
			}
		} else if (config.background_hue !== undefined) {
			// Legacy hue present — create migrated theme and apply
			console.info(`Migrating legacy background_hue (${config.background_hue}) to theme`);
			theme = validateTheme({
				id: "custom-migrated",
				name: "Migrated Theme",
				primaryHue: config.background_hue,
				style: (config.theme_style as any) || "glass",
				gradientEnabled: config.theme_gradient_enabled ?? true,
				gradientAngle: config.theme_gradient_angle ?? 135,
				gradientHarmony: config.theme_gradient_harmony || "complementary",
			});
		}

		// Only apply if we have a theme from config; otherwise preserve current app theme
		if (theme) {
			applyTheme(theme);
			// Keep legacy variable for backwards compatibility during migration
			style.setProperty("--color__primary-hue", theme.primaryHue.toString());
			console.info("Theme applied from config");
		} else {
			console.info("No explicit theme found in config, preserving existing app theme");
		}
	} catch (error) {
		console.warn("Failed to load theme config — preserving existing theme:", error);
	}
}
