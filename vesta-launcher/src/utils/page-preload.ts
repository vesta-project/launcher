import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "@utils/tauri-runtime";

type IdleWindow = Window & {
	requestIdleCallback?: (
		callback: () => void,
		options?: { timeout: number },
	) => number;
};

function scheduleIdle(callback: () => void): void {
	const idleWindow = window as IdleWindow;
	if (idleWindow.requestIdleCallback) {
		idleWindow.requestIdleCallback(callback, { timeout: 1500 });
		return;
	}
	window.setTimeout(callback, 250);
}

/**
 * Keep route loading policy in one place. The most common mini pages are parsed
 * after the main surface paints, without making them part of the startup entry.
 */
export function scheduleCommonPagePreloads(): void {
	scheduleIdle(() => {
		if (hasTauriRuntime()) {
			void invoke("prime_mini_window").catch((error) => {
				console.warn("Failed to prime reusable mini window:", error);
			});
		}

		void Promise.all([
			import("@components/pages/mini-pages/settings/settings-page"),
			import(
				"@components/pages/mini-pages/instance-details/instance-details"
			),
			import("@stores/settings").then(({ initSettings }) => initSettings()),
		]).catch((error) => {
			console.warn("Failed to preload common mini pages:", error);
		});
	});
}
