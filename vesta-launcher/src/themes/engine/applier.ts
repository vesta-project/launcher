import { themeToCSSVars } from "./themeToCSSVars";
import { normalizeWindowEffectForCurrentOS } from "./effects";
import type { ThemeConfig } from "../types";

export function applyTheme(theme: ThemeConfig): void {
	const root = document.documentElement;
	const style = root.style;

	// Apply CSS variables
	const vars = themeToCSSVars(theme);

	// Multi-criteria identity check for the theme
	const themeId = theme.id;
	const currentThemeId = root.getAttribute("data-theme-id");

	// Skip if theme is already applied (check all relevant fields)
	const currentHue = style.getPropertyValue("--color__primary-hue").trim();
	const currentRotation = style.getPropertyValue("--rotation").trim();
	const currentSecondaryHue = style.getPropertyValue("--hue-secondary").trim();
	const currentBackgroundOpacity = style
		.getPropertyValue("--background-opacity")
		.trim();
	const currentOpacity = style.getPropertyValue("--effect-opacity").trim();
	const currentWindowEffect = root.getAttribute("data-window-effect") || "none";
	const currentBorderWidth = style
		.getPropertyValue("--border-width-subtle")
		.trim();
	const nextThemeVarKeys = Object.keys(vars).filter((key) =>
		key.startsWith("--theme-var-"),
	);
	const previousThemeVarKeys = (root.getAttribute("data-theme-var-keys") || "")
		.split(",")
		.map((key) => key.trim())
		.filter((key) => key.length > 0);
	const hasRemovedThemeVars = previousThemeVarKeys.some(
		(key) => !nextThemeVarKeys.includes(key),
	);

	const styleTag = document.getElementById(
		"theme-custom-css",
	) as HTMLStyleElement | null;
	const currentCustomCss = (styleTag?.textContent || "").trim();
	const nextCustomCss = (theme.customCss || "").trim();
	const customCssChanged = currentCustomCss !== nextCustomCss;

	const updateCustomCss = (t: ThemeConfig) => {
		const tagId = "theme-custom-css";
		let styleTag = document.getElementById(tagId) as HTMLStyleElement | null;
		const normalizedCss = (t.customCss || "").trim();

		if (normalizedCss.length > 0) {
			if (!styleTag) {
				styleTag = document.createElement("style");
				styleTag.id = tagId;
				document.head.appendChild(styleTag);
			}
			if (styleTag.textContent !== normalizedCss) {
				styleTag.textContent = normalizedCss;
			}
		} else if (styleTag && styleTag.textContent !== "") {
			styleTag.textContent = "";
		}
	};

	// Helper for numeric string comparison with epsilon
	const numMatch = (a: string, b: string) => {
		if (!a || !b) return a === b;
		const na = parseFloat(a);
		const nb = parseFloat(b);
		if (isNaN(na) || isNaN(nb)) return a === b;
		return Math.abs(na - nb) < 0.005;
	};

	// Force update if the root attribute hasn't been set yet (prevents "pre-initialized" skip)
	const isFirstApply = !currentThemeId;

	if (
		!isFirstApply &&
		currentThemeId === themeId &&
		currentHue === theme.primaryHue.toString() &&
		root.getAttribute("data-style") === theme.style &&
		root.getAttribute("data-gradient") ===
			(theme.gradientEnabled ? "1" : "0") &&
		root.getAttribute("data-gradient-type") ===
			(theme.gradientType || "linear") &&
		currentRotation === vars["--rotation"] &&
		currentSecondaryHue === vars["--hue-secondary"] &&
		numMatch(currentBackgroundOpacity, vars["--background-opacity"]) &&
		numMatch(currentOpacity, vars["--effect-opacity"]) &&
		currentWindowEffect === (theme.windowEffect || "none") &&
		currentBorderWidth === vars["--border-width-subtle"]
	) {
		const anyVarChanged = nextThemeVarKeys.some((key) => {
			const current = style.getPropertyValue(key).trim();
			const next = vars[key];
			return current !== next;
		});

		if (!anyVarChanged && !hasRemovedThemeVars && !customCssChanged) {
			updateCustomCss(theme);
			return;
		}
	}

	for (const staleKey of previousThemeVarKeys) {
		if (!nextThemeVarKeys.includes(staleKey)) {
			style.removeProperty(staleKey);
		}
	}

	for (const [key, value] of Object.entries(vars)) {
		if (style.getPropertyValue(key).trim() !== value) {
			style.setProperty(key, value as string);
		}
	}

	updateCustomCss(theme);
	root.setAttribute("data-theme-id", themeId);
	root.setAttribute("data-theme-var-keys", nextThemeVarKeys.join(","));

	const effectToSet = normalizeWindowEffectForCurrentOS(
		theme.windowEffect || "none",
	);
	if (currentWindowEffect !== effectToSet || isFirstApply) {
		root.setAttribute("data-window-effect", effectToSet);
		if ((window as any).__TAURI_INTERNALS__) {
			import("@tauri-apps/api/core").then(({ invoke }) => {
				invoke("set_window_effect", { effect: effectToSet }).catch(
					console.error,
				);
			});
		}
	}

	// Ensure background behaves correctly when toggling gradient
	if (theme.gradientEnabled) {
		root.setAttribute("data-gradient", "1");
		// Let stylesheet-defined gradient and opacity take over (CSS media queries handle light/dark)
		style.removeProperty("--background-color");
	} else {
		root.setAttribute("data-gradient", "0");
		// Force solid background
		style.setProperty("--background-color", "var(--surface-base)");
	}

	// Apply style mode attribute
	root.setAttribute("data-style", theme.style ?? "solid");
	root.setAttribute("data-gradient-type", theme.gradientType || "linear");

	// Apply color scheme attribute (forces dark/light mode regardless of system)
	if (theme.colorScheme) {
		root.setAttribute("data-theme", theme.colorScheme);
	} else {
		root.removeAttribute("data-theme");
	}

	// Apply bordered mode (removes blur/transparency, stronger borders)
	if (theme.style === "bordered") {
		root.setAttribute("data-bordered", "true");
	} else {
		root.removeAttribute("data-bordered");
	}

	// Apply solid mode (100% opacity, no blur)
	if (theme.style === "solid") {
		root.setAttribute("data-solid", "true");
	} else {
		root.removeAttribute("data-solid");
	}
}
