import type { OsType } from "@tauri-apps/plugin-os";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createSignal, onMount } from "solid-js";

let osType: OsType | undefined;
let osTypePromise: Promise<OsType | undefined> | null = null;

function loadOsType(): Promise<OsType | undefined> {
	if (!hasTauriRuntime()) {
		return Promise.resolve(undefined);
	}
	if (!osTypePromise) {
		osTypePromise = import("@tauri-apps/plugin-os")
			.then(async (module) => {
				if (typeof module.type !== "function") {
					return undefined;
				}
				try {
					const resolved = await module.type();
					osType = resolved;
					return resolved;
				} catch (error) {
					console.debug("Failed to query plugin os.type()", error);
					return undefined;
				}
			})
			.catch((error) => {
				console.debug("Failed to import plugin-os", error);
				return undefined;
			});
	}
	return osTypePromise;
}

// kick off async detection without blocking callers
void loadOsType();

export function getOsType(): OsType | undefined {
	return osType;
}

export function ensureOsType(): Promise<OsType | undefined> {
	return loadOsType();
}

// Solid helper to get a reactive OS signal with async resolution.
// Usage: const os = useOs(); then read os() inside components.
export function useOs(defaultOs: string = "windows") {
	// Try to get OS from data-os attribute (set by init script in index.html)
	const initialOsAttr = document.documentElement.getAttribute("data-os") || defaultOs;
	const [os, setOs] = createSignal<string>(initialOsAttr);

	onMount(() => {
		const initial = getOsType();
		if (initial) {
			setOs(initial);
		} else {
			ensureOsType().then((resolved) => {
				if (resolved) setOs(resolved);
			});
		}
	});

	return os;
}
