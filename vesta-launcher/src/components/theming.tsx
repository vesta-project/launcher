import { invoke } from "@tauri-apps/api/core";
import { applyConfigSnapshot } from "@utils/config-sync";
import { ensureOsType } from "@utils/os";
import { createSignal } from "solid-js";

const [isThemeReady, setIsThemeReady] = createSignal(false);
let themeInitPromise: Promise<Record<string, any> | null> | null = null;

function applyStartupFallbackTheme(): void {
	const root = document.documentElement;
	if (!root.getAttribute("data-window-effect")) {
		root.setAttribute("data-window-effect", "none");
	}

	root.style.setProperty("--app-background-tint", "#141414");
	root.style.setProperty("--background-color", "#141414");
	root.style.setProperty("--background-image", "none");
}

/**
 * Initialize theme system from config
 * This is called early in index.tsx to prevent FOUC
 */
export function initTheme(): Promise<Record<string, any> | null> {
	if (themeInitPromise) {
		return themeInitPromise;
	}

	themeInitPromise = (async () => {
		if (isThemeReady()) {
			return null;
		}

		try {
			applyStartupFallbackTheme();

			// Start config fetching as early as possible
			const configPromise = invoke<Record<string, any>>("get_config");

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

			applyConfigSnapshot(config);
			setIsThemeReady(true);
			console.info("Initial theme applied from config");
			return config;
		} catch (error) {
			console.warn(
				"Failed to load theme config — preserving existing theme:",
				error,
			);
			applyStartupFallbackTheme();
			// Even if it fails, we mark it as ready so the app can continue
			setIsThemeReady(true);
			return null;
		}
	})();

	return themeInitPromise;
}

export { isThemeReady };
