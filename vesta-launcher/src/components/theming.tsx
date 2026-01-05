import { invoke } from "@tauri-apps/api/core";
import { applyConfigSnapshot } from "@utils/config-sync";

/**
 * Initialize theme system from config
 * This is called early in index.tsx to prevent FOUC
 */
export async function initTheme() {
	try {
		const config = await invoke("get_config");
		applyConfigSnapshot(config as Record<string, any>);
		console.info("Initial theme applied from config");
	} catch (error) {
		console.warn(
			"Failed to load theme config — preserving existing theme:",
			error,
		);
	}
}
