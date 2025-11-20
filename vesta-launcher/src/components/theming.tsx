import { invoke } from "@tauri-apps/api/core";
import { JSX } from "solid-js";

interface AppConfig {
	debug_logging: boolean;
	background_hue: number;
	[key: string]: any;
}

// Initialise css variables that are overridden
export async function initTheme() {
	const root = document.documentElement;
	const style = root.style;

	// Set all properties at once for better performance
	style.setProperty("--font-xxsmall", "0.75rem");
	style.setProperty("--font-xsmall", "0.85rem");
	style.setProperty("--font-small", "1rem");
	style.setProperty("--font-medium", "1.25rem");
	style.setProperty("--font-large", "2rem");
	style.setProperty("--font-xlarge", "4rem");
	style.setProperty("--background-opacity", "0.1");

	// Load background_hue from config
	try {
		const config = await invoke<AppConfig>("get_config");
		style.setProperty("--color__primary-hue", config.background_hue.toString());
		console.log("Theme initialized with hue:", config.background_hue);
	} catch (error) {
		console.error("Failed to load theme config, using default:", error);
		style.setProperty("--color__primary-hue", "220"); // Default hue
	}
}
