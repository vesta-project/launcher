export type ThemeApplyTransition = "none" | "preset-switch";

export interface ThemeApplyOptions {
	transition?: ThemeApplyTransition;
	transitionDurationMs?: number;
}

const DEFAULT_TRANSITION_MS = 140;
const MIN_TRANSITION_MS = 80;
const MAX_TRANSITION_MS = 260;

let activeTransitionToken = 0;
let clearTransitionTimer: number | undefined;

function clampTransitionDuration(value?: number): number {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return DEFAULT_TRANSITION_MS;
	}
	if (value < MIN_TRANSITION_MS) {
		return MIN_TRANSITION_MS;
	}
	if (value > MAX_TRANSITION_MS) {
		return MAX_TRANSITION_MS;
	}
	return Math.round(value);
}

function clearTransition(root: HTMLElement, token: number): void {
	if (token !== activeTransitionToken) {
		return;
	}

	root.removeAttribute("data-theme-transition");
	root.style.removeProperty("--theme-transition-duration");
	clearTransitionTimer = undefined;
}

/**
 * Marks a short global preset-switch transition.
 * Rapid consecutive calls are tokenized so the newest switch always wins.
 */
export function startThemeTransition(options?: ThemeApplyOptions): void {
	if (options?.transition !== "preset-switch") {
		return;
	}

	if (typeof document === "undefined" || typeof window === "undefined") {
		return;
	}

	const root = document.documentElement;
	const duration = clampTransitionDuration(options.transitionDurationMs);
	const token = ++activeTransitionToken;

	if (clearTransitionTimer !== undefined) {
		window.clearTimeout(clearTransitionTimer);
	}

	root.setAttribute("data-theme-transition", "preset-switch");
	root.style.setProperty("--theme-transition-duration", `${duration}ms`);

	clearTransitionTimer = window.setTimeout(() => {
		clearTransition(root, token);
	}, duration + 34);
}
