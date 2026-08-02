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

export function getStartupSnapshot(): VestaStartupSnapshot | undefined {
	return window.__VESTA_BOOTSTRAP__;
}

export function getStartupConfig(): Record<string, any> | undefined {
	return getStartupSnapshot()?.config;
}

export function updateStartupConfigField(field: string, value: unknown): void {
	const snapshot = getStartupSnapshot();
	if (!snapshot) {
		window.__VESTA_BOOTSTRAP__ = { config: { [field]: value } };
		return;
	}
	snapshot.config = { ...(snapshot.config ?? {}), [field]: value };
}
