import * as Sentry from "@sentry/browser";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { defaultOptions } from "tauri-plugin-sentry-api";

let sentryInitialized = false;

async function isTelemetryEnabled(): Promise<boolean> {
	try {
		const config = await invoke<{ telemetry_enabled?: boolean }>("get_config");
		return config.telemetry_enabled ?? true;
	} catch (error) {
		console.warn("Failed to read telemetry setting, defaulting to enabled:", error);
		return true;
	}
}

export async function initSentryMonitoring() {
	if (sentryInitialized || !hasTauriRuntime()) {
		return;
	}

	const enableInDev = import.meta.env.VITE_SENTRY_ENABLE_IN_DEV === "true";
	if (!import.meta.env.PROD && !enableInDev) {
		return;
	}

	if (!(await isTelemetryEnabled())) {
		return;
	}

	// Plugin auto-injection handles all transport, event capture, and breadcrumbs
	// Just configure environment and release tags
	Sentry.init({
		...defaultOptions,
		release: import.meta.env.VITE_APP_RELEASE || undefined,
		environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || (import.meta.env.DEV ? "development" : "production"),
	});

	Sentry.setTag("app_layer", "frontend");
	sentryInitialized = true;
}
