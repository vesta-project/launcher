import type { ThemeConfig } from "../types";

const BUILTIN_WINDOW_EFFECTS = ["none", "vibrancy", "liquid_glass"] as const;
const WINDOWS_WINDOW_EFFECTS = ["none", "mica", "acrylic", "blur"] as const;
const FALLBACK_WINDOW_EFFECT = "none";

export function getCurrentOsHint(): string {
	if (typeof document !== "undefined") {
		const attr = document.documentElement.getAttribute("data-os");
		if (attr && attr.trim().length > 0) {
			return attr.trim().toLowerCase();
		}
	}

	if (typeof window !== "undefined") {
		const hinted = (window as any).__VESTA_OS__;
		if (typeof hinted === "string" && hinted.trim().length > 0) {
			return hinted.trim().toLowerCase();
		}
	}

	return "";
}

export function getSupportedWindowEffects(osHint?: string): string[] {
	const os = (osHint || getCurrentOsHint()).toLowerCase();
	if (os === "macos") {
		return [...BUILTIN_WINDOW_EFFECTS];
	}
	if (os === "windows") {
		return [...WINDOWS_WINDOW_EFFECTS];
	}
	return [FALLBACK_WINDOW_EFFECT];
}

export function normalizeWindowEffectForCurrentOS(
	effect?: string,
	osHint?: string,
): string {
	const requested = (effect || "").trim().toLowerCase();
	if (!requested) return FALLBACK_WINDOW_EFFECT;

	const supported = getSupportedWindowEffects(osHint);
	return supported.includes(requested) ? requested : FALLBACK_WINDOW_EFFECT;
}
