import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriRuntime } from "@utils/tauri-runtime";

const HIDDEN_WINDOW_PAINT_FALLBACK_MS = 100;

/**
 * Wait for two animation frames when the webview is paintable.
 *
 * Hidden WKWebViews on macOS suspend requestAnimationFrame, so a bounded timer
 * must also be able to release startup and reusable mini-window work.
 */
export function afterNextPaint(
	fallbackMs = HIDDEN_WINDOW_PAINT_FALLBACK_MS,
): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		let firstFrame: number | undefined;
		let secondFrame: number | undefined;

		const finish = () => {
			if (settled) return;
			settled = true;
			window.clearTimeout(fallback);
			if (firstFrame !== undefined) {
				window.cancelAnimationFrame(firstFrame);
			}
			if (secondFrame !== undefined) {
				window.cancelAnimationFrame(secondFrame);
			}
			resolve();
		};

		const fallback = window.setTimeout(finish, fallbackMs);
		firstFrame = window.requestAnimationFrame(() => {
			secondFrame = window.requestAnimationFrame(finish);
		});
	});
}

export async function presentCurrentWindowAfterPaint(): Promise<void> {
	if (!hasTauriRuntime()) return;
	await afterNextPaint();
	const label = getCurrentWindow().label;
	await invoke("present_window_when_ready", {
		label,
	});
}
