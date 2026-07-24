import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriRuntime } from "@utils/tauri-runtime";

export function afterNextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
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
