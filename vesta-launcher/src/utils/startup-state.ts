export interface VestaStartupSnapshot {
	os?: "windows" | "macos" | "linux";
	config?: Record<string, any>;
}

declare global {
	interface Window {
		__VESTA_BOOTSTRAP__?: VestaStartupSnapshot;
		__VESTA_OS__?: string;
	}
}

const STARTUP_CONFIG_CONSUMED_KEY = "vesta-startup-config-consumed";
let startupConfigResolved = false;
let startupConfig: Record<string, any> | undefined;

export function getStartupSnapshot(): VestaStartupSnapshot | undefined {
	return window.__VESTA_BOOTSTRAP__;
}

export function getStartupConfig(): Record<string, any> | undefined {
	if (startupConfigResolved) return startupConfig;

	startupConfigResolved = true;
	startupConfig = getStartupSnapshot()?.config;
	if (!startupConfig) return undefined;

	try {
		if (window.sessionStorage.getItem(STARTUP_CONFIG_CONSUMED_KEY) === "1") {
			startupConfig = undefined;
		} else {
			window.sessionStorage.setItem(STARTUP_CONFIG_CONSUMED_KEY, "1");
		}
	} catch {
		// Some webviews can deny storage access. The injected snapshot is still a
		// safe fallback for the initial page load in that case.
	}

	return startupConfig;
}

export function updateStartupConfigField(field: string, value: unknown): void {
	const snapshot = getStartupSnapshot();
	if (!snapshot) {
		window.__VESTA_BOOTSTRAP__ = { config: { [field]: value } };
		return;
	}
	snapshot.config = { ...(snapshot.config ?? {}), [field]: value };
}
