import * as Sentry from "@sentry/browser";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { defaultOptions } from "tauri-plugin-sentry-api";

let sentryInitialized = false;

export function initSentryMonitoring() {
	if (sentryInitialized || !hasTauriRuntime()) {
		return;
	}

	const enableInDev = import.meta.env.VITE_SENTRY_ENABLE_IN_DEV === "true";
	if (!import.meta.env.PROD && !enableInDev) {
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
