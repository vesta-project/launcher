const BUILTIN_WINDOW_EFFECTS = [
	"none",
	"transparent",
	"vibrancy",
	"liquid_glass",
] as const;
const WINDOWS_WINDOW_EFFECTS = [
	"none",
	"transparent",
	"mica",
	"acrylic",
	"blur",
] as const;
const FALLBACK_WINDOW_EFFECTS = ["none", "transparent"] as const;
const FALLBACK_WINDOW_EFFECT = "none";

export interface WindowEffectCapabilities {
	os: string;
	osVersion?: string | null;
	supportedEffects: string[];
	defaultEffect: string;
}

let capabilityCache: WindowEffectCapabilities | null = null;
let capabilityPending: Promise<WindowEffectCapabilities | null> | null = null;

function hasTauriRuntime(): boolean {
	return (
		typeof window !== "undefined" &&
		Boolean((window as any).__TAURI_INTERNALS__)
	);
}

function normalizeCapabilityPayload(
	payload: WindowEffectCapabilities,
): WindowEffectCapabilities {
	const normalized: string[] = [];
	for (const effect of payload.supportedEffects || []) {
		const key = (effect || "").trim().toLowerCase();
		if (!key || normalized.includes(key)) continue;
		normalized.push(key);
	}

	if (!normalized.includes(FALLBACK_WINDOW_EFFECT)) {
		normalized.unshift(FALLBACK_WINDOW_EFFECT);
	}

	return {
		os: (payload.os || "").trim().toLowerCase(),
		osVersion: payload.osVersion ?? null,
		supportedEffects: normalized,
		defaultEffect: (payload.defaultEffect || FALLBACK_WINDOW_EFFECT)
			.trim()
			.toLowerCase(),
	};
}

export async function loadWindowEffectCapabilities(): Promise<WindowEffectCapabilities | null> {
	if (capabilityCache) return capabilityCache;
	if (capabilityPending) return capabilityPending;
	if (!hasTauriRuntime()) return null;

	capabilityPending = import("@tauri-apps/api/core")
		.then(async ({ invoke }) => {
			const payload = await invoke<WindowEffectCapabilities>(
				"get_window_effect_capabilities",
			);
			capabilityCache = normalizeCapabilityPayload(payload);
			return capabilityCache;
		})
		.catch((error) => {
			console.warn("Failed to load window effect capabilities:", error);
			return null;
		})
		.finally(() => {
			capabilityPending = null;
		});

	return capabilityPending;
}

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
	if (capabilityCache?.supportedEffects?.length) {
		return [...capabilityCache.supportedEffects];
	}

	const os = (osHint || getCurrentOsHint()).toLowerCase();
	if (os === "macos") {
		return [...BUILTIN_WINDOW_EFFECTS];
	}
	if (os === "windows") {
		return [...WINDOWS_WINDOW_EFFECTS];
	}
	return [...FALLBACK_WINDOW_EFFECTS];
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
