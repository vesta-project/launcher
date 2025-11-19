import type { OsType } from "@tauri-apps/plugin-os";
import { hasTauriRuntime } from "@utils/tauri-runtime";

let osType: OsType | undefined;
let osTypePromise: Promise<OsType | undefined> | null = null;

async function loadOsType(): Promise<OsType | undefined> {
	if (!hasTauriRuntime()) {
		return undefined;
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
