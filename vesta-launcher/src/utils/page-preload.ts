import { invoke } from "@tauri-apps/api/core";
import { scheduleIdleTask } from "@utils/idle-task";
import { hasTauriRuntime } from "@utils/tauri-runtime";

/**
 * Keep route loading policy in one place. The most common mini pages are parsed
 * after the main surface paints, without making them part of the startup entry.
 */
export function scheduleCommonPagePreloads(): void {
	scheduleIdleTask(() => {
		if (hasTauriRuntime()) {
			void invoke("prime_mini_window").catch((error) => {
				console.warn("Failed to prime reusable mini window:", error);
			});
		}

		void Promise.all([
			import("@components/page-viewer/mini-router-config").then(
				({ prepareCommonMiniRoutes }) => prepareCommonMiniRoutes(),
			),
		]).catch((error) => {
			console.warn("Failed to preload common mini pages:", error);
		});
	});
}
