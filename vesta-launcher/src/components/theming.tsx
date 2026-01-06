import { invoke } from "@tauri-apps/api/core";
import { applyConfigSnapshot } from "@utils/config-sync";
import { createSignal } from "solid-js";

const [isThemeReady, setIsThemeReady] = createSignal(false);

/**
 * Initialize theme system from config
 * This is called early in index.tsx to prevent FOUC
 */
export async function initTheme() {
	if (isThemeReady()) return;
	
	try {
		const config = await invoke("get_config");
		applyConfigSnapshot(config as Record<string, any>);
		setIsThemeReady(true);
		console.info("Initial theme applied from config");
	} catch (error) {
		console.warn(
			"Failed to load theme config — preserving existing theme:",
			error,
		);
		// Even if it fails, we mark it as ready so the app can continue
		setIsThemeReady(true);
	}
}

export { isThemeReady };
