import { invoke } from "@tauri-apps/api/core";
import { applyConfigSnapshot } from "@utils/config-sync";
import { ensureOsType } from "@utils/os";
import { createSignal } from "solid-js";

const [isThemeReady, setIsThemeReady] = createSignal(false);

/**
 * Initialize theme system from config
 * This is called early in index.tsx to prevent FOUC
 */
export async function initTheme() {
	if (isThemeReady()) return;

	try {
		// Start config fetching as early as possible
		const configPromise = invoke("get_config");

		// Attempt to get OS from initialization script or URL parameters (instant)
		const urlParams = new URLSearchParams(window.location.search);
		const urlOs = (window as any).__VESTA_OS__ || urlParams.get("os");
		if (urlOs) {
			document.documentElement.setAttribute("data-os", urlOs);
		}

		// Parallelize OS verification and config fetching
		const osPromise = ensureOsType();
		const [os, config] = await Promise.all([osPromise, configPromise]);

		// Actualize the OS attribute if detection finishes and differs (or was missing)
		if (os && os !== urlOs) {
			document.documentElement.setAttribute("data-os", os);
		}

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
