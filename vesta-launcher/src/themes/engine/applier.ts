import type { ThemeConfig } from "../types";
import { normalizeWindowEffectForCurrentOS } from "./effects";
import { themeToCSSVars } from "./themeToCSSVars";
import { startThemeTransition, type ThemeApplyOptions } from "./transitionManager";

export type { ThemeApplyOptions, ThemeApplyTransition } from "./transitionManager";

const STARTUP_FALLBACK_ATTR = "data-startup-fallback-active";

function clearStartupFallbackIfActive(root: HTMLElement, style: CSSStyleDeclaration): void {
	if (root.getAttribute(STARTUP_FALLBACK_ATTR) !== "1") {
		return;
	}

	style.removeProperty("--app-background-tint");
	style.removeProperty("--background-color");
	style.removeProperty("--background-image");
	root.removeAttribute(STARTUP_FALLBACK_ATTR);
}

function applyBackgroundState(
	theme: ThemeConfig,
	effectToSet: string,
	root: HTMLElement,
	style: CSSStyleDeclaration,
): void {
	const isWindowEffectEnabled = effectToSet !== "none" && effectToSet !== "";

	if (theme.gradientEnabled) {
		root.setAttribute("data-gradient", "1");
		style.removeProperty("--background-image");
	} else {
		root.setAttribute("data-gradient", "0");
		// When gradient is disabled, we style it as a "solid gradient" using a single color.
		// This keeps the property active while visually appearing as a solid background.
		style.setProperty("--background-image", "linear-gradient(var(--app-background-tint), var(--app-background-tint))");
	}

	if (isWindowEffectEnabled) {
		// Native effects should always reveal the OS material with no static app tint.
		style.removeProperty("--background-color");
		return;
	}

	if (theme.gradientEnabled) {
		style.removeProperty("--background-color");
		return;
	}

	style.setProperty("--background-color", "var(--app-background-tint)");
}

export function applyTheme(theme: ThemeConfig, options: ThemeApplyOptions = {}): void {
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
	const currentBackgroundOpacity = style.getPropertyValue("--background-opacity").trim();
	const currentOpacity = style.getPropertyValue("--effect-opacity").trim();
	const currentWindowEffect = root.getAttribute("data-window-effect") || "none";
	const currentBorderWidth = style.getPropertyValue("--border-width-subtle").trim();
	const effectToSet = normalizeWindowEffectForCurrentOS(theme.windowEffect || "none");
	const nextThemeVarKeys = Object.keys(vars).filter((key) => key.startsWith("--theme-var-"));
	const previousThemeVarKeys = (root.getAttribute("data-theme-var-keys") || "")
		.split(",")
		.map((key) => key.trim())
		.filter((key) => key.length > 0);
	const hasRemovedThemeVars = previousThemeVarKeys.some((key) => !nextThemeVarKeys.includes(key));

	const styleTag = document.getElementById("theme-custom-css") as HTMLStyleElement | null;
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
		root.getAttribute("data-gradient") === (theme.gradientEnabled ? "1" : "0") &&
		root.getAttribute("data-gradient-type") === (theme.gradientType || "linear") &&
		currentRotation === vars["--rotation"] &&
		currentSecondaryHue === vars["--hue-secondary"] &&
		numMatch(currentBackgroundOpacity, vars["--background-opacity"]) &&
		numMatch(currentOpacity, vars["--effect-opacity"]) &&
		currentWindowEffect === effectToSet &&
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

	startThemeTransition(options);

	for (const [key, value] of Object.entries(vars)) {
		if (style.getPropertyValue(key).trim() !== value) {
			style.setProperty(key, value as string);
		}
	}

	clearStartupFallbackIfActive(root, style);

	updateCustomCss(theme);
	root.setAttribute("data-theme-id", themeId);
	root.setAttribute("data-theme-var-keys", nextThemeVarKeys.join(","));

	applyBackgroundState(theme, effectToSet, root, style);

	if (currentWindowEffect !== effectToSet || isFirstApply) {
		root.setAttribute("data-window-effect", effectToSet);
		if ((window as any).__TAURI_INTERNALS__) {
			import("@tauri-apps/api/core").then(({ invoke }) => {
				invoke("set_window_effect", { effect: effectToSet }).catch(console.error);
			});
		}
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
