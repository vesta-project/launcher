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

	// Load theme configuration
	try {
		const config = await invoke<AppConfig>("get_config");
		let theme: ThemeConfig;

		// Migration path: Check for new theme_id first, fall back to legacy background_hue
		if (config.theme_id) {
			// New system: Load theme preset by ID
			const presetTheme = getThemeById(config.theme_id);
			if (presetTheme) {
				theme = presetTheme;
				console.log(`Theme loaded from preset: ${theme.name} (${theme.id})`);
			} else {
				// Unknown theme ID, fallback to default
				console.warn(`Unknown theme ID "${config.theme_id}", using default`);
				theme = getDefaultTheme();
			}
		} else if (config.background_hue !== undefined) {
			// Legacy system: Migrate from single hue value to midnight theme with custom hue
			console.log(`Migrating legacy background_hue (${config.background_hue}) to new theme system`);
			theme = validateTheme({
				id: "custom-migrated",
				name: "Migrated Theme",
				primaryHue: config.background_hue,
				style: (config.theme_style as any) || "glass",
				gradientEnabled: config.theme_gradient_enabled ?? true,
				gradientAngle: 135,
				gradientHarmony: "complementary",
			});
		} else {
			// No theme config found, use default
			console.log("No theme config found, using default theme");
			theme = getDefaultTheme();
		}

		// Apply the theme to the document
		applyTheme(theme);

		// Keep legacy variable for backwards compatibility during migration
		style.setProperty("--color__primary-hue", theme.primaryHue.toString());
		
	} catch (error) {
		console.error("Failed to load theme config, using default:", error);
		
		// Emergency fallback
		const defaultTheme = getDefaultTheme();
		applyTheme(defaultTheme);
		style.setProperty("--color__primary-hue", "220");
	}
}
