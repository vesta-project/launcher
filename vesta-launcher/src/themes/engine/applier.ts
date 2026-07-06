import { invoke } from "@tauri-apps/api/core";
import type { ThemeConfig } from "../types";
import { normalizeWindowEffectForCurrentOS } from "./effects";
import { themeToCSSVars } from "./themeToCSSVars";
import {
	startThemeTransition,
	type ThemeApplyOptions,
} from "./transitionManager";

export type {
	ThemeApplyOptions,
	ThemeApplyTransition,
} from "./transitionManager";

const STARTUP_FALLBACK_ATTR = "data-startup-fallback-active";
const CUSTOM_CSS_TAG_ID = "theme-custom-css";
const CUSTOM_CSS_OWNER_ATTR = "data-theme-custom-css-owner";

function clearStartupFallbackIfActive(
	root: HTMLElement,
	style: CSSStyleDeclaration,
): void {
	if (root.getAttribute(STARTUP_FALLBACK_ATTR) !== "1") {
		return;
	}

	style.removeProperty("--app-background-tint");
	style.removeProperty("--background-color");
	style.removeProperty("--background-image");
	root.removeAttribute(STARTUP_FALLBACK_ATTR);
}

function getThemeVarKeysFromStyle(style: CSSStyleDeclaration): string[] {
	const keys: string[] = [];
	for (let i = 0; i < style.length; i += 1) {
		const key = style.item(i);
		if (key.startsWith("--theme-var-")) {
			keys.push(key);
		}
	}
	return keys;
}

function applyCustomCss(theme: ThemeConfig): void {
	const normalizedCss = (theme.customCss || "").trim();
	const existing = document.getElementById(
		CUSTOM_CSS_TAG_ID,
	) as HTMLStyleElement | null;

	if (normalizedCss.length === 0) {
		existing?.remove();
		return;
	}

	const styleTag = existing ?? document.createElement("style");
	if (!existing) {
		styleTag.id = CUSTOM_CSS_TAG_ID;
		document.head.appendChild(styleTag);
	}

	if (styleTag.textContent !== normalizedCss) {
		styleTag.textContent = normalizedCss;
	}
	styleTag.setAttribute(CUSTOM_CSS_OWNER_ATTR, theme.id);
}

/**
 * Applies background-image and background-color CSS variables based on
 * the gradient and window-effect state.
 *
 * Decision matrix:
 *
 *   --background-image  ← gradient on → CSS default gradient (remove inline)
 *                       ← gradient off → solid tint-with-opacity gradient
 *
 *   --background-color  ← effect active → transparent (OS provides base color)
 *                       ← effect none   → --app-background-tint (we provide base color)
 *
 * The CSS rules in styles.css (data-window-effect selectors on #app) read these
 * variables and set the actual background-color / background-image properties.
 */
function applyBackgroundState(
	theme: ThemeConfig,
	effectToSet: string,
	root: HTMLElement,
	style: CSSStyleDeclaration,
): void {
	const isWindowEffectEnabled = effectToSet !== "none" && effectToSet !== "";

	root.setAttribute("data-gradient", theme.gradientEnabled ? "1" : "0");

	if (theme.gradientEnabled) {
		style.removeProperty("--background-image");
	} else {
		style.setProperty(
			"--background-image",
			"linear-gradient(var(--app-background-tint-with-opacity), var(--app-background-tint-with-opacity))",
		);
	}

	if (isWindowEffectEnabled) {
		style.removeProperty("--background-color");
	} else {
		style.setProperty("--background-color", "var(--app-background-tint)");
	}
}

export function applyTheme(
	theme: ThemeConfig,
	options: ThemeApplyOptions = {},
): void {
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
	const effectToSet = normalizeWindowEffectForCurrentOS(
		theme.windowEffect || "none",
	);
	const styleMode = theme.style ?? "glass";
	const nextThemeVarKeys = Object.keys(vars).filter((key) =>
		key.startsWith("--theme-var-"),
	);
	const previousTrackedThemeVarKeys = (
		root.getAttribute("data-theme-var-keys") || ""
	)
		.split(",")
		.map((key) => key.trim())
		.filter((key) => key.length > 0);
	const previousThemeVarKeys = Array.from(
		new Set([
			...previousTrackedThemeVarKeys,
			...getThemeVarKeysFromStyle(style),
		]),
	);
	const hasRemovedThemeVars = previousThemeVarKeys.some(
		(key) => !nextThemeVarKeys.includes(key),
	);

	const styleTag = document.getElementById(
		"theme-custom-css",
	) as HTMLStyleElement | null;
	const currentCustomCss = (styleTag?.textContent || "").trim();
	const nextCustomCss = (theme.customCss || "").trim();
	const customCssOwner = styleTag?.getAttribute(CUSTOM_CSS_OWNER_ATTR) || "";
	const customCssChanged =
		currentCustomCss !== nextCustomCss ||
		(nextCustomCss.length > 0 && customCssOwner !== themeId) ||
		(nextCustomCss.length === 0 && styleTag !== null);

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
		root.getAttribute("data-style") === styleMode &&
		root.getAttribute("data-gradient") ===
			(theme.gradientEnabled ? "1" : "0") &&
		root.getAttribute("data-gradient-type") ===
			(theme.gradientType || "linear") &&
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
			applyCustomCss(theme);
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

	root.setAttribute("data-theme-id", themeId);
	root.setAttribute("data-theme-var-keys", nextThemeVarKeys.join(","));
	applyCustomCss(theme);

	applyBackgroundState(theme, effectToSet, root, style);

	if (currentWindowEffect !== effectToSet || isFirstApply) {
		root.setAttribute("data-window-effect", effectToSet);
		if ((window as any).__TAURI_INTERNALS__) {
			invoke("set_window_effect", { effect: effectToSet }).catch(console.error);
		}
	}

	// Apply style mode attribute
	root.setAttribute("data-style", styleMode);
	root.setAttribute("data-gradient-type", theme.gradientType || "linear");

	// Apply color scheme attribute (forces dark/light mode regardless of system)
	if (theme.colorScheme) {
		root.setAttribute("data-theme", theme.colorScheme);
	} else {
		root.removeAttribute("data-theme");
	}

	root.removeAttribute("data-bordered");
	root.removeAttribute("data-solid");
}
