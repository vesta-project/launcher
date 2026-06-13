import { listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createSignal, onCleanup, onMount } from "solid-js";

export function useWindowFullscreen() {
	const [isFullscreen, setIsFullscreen] = createSignal(false);

	onMount(() => {
		if (!hasTauriRuntime()) {
			return;
		}

		const appWindow = getCurrentWindow();
		let disposed = false;
		let unlisten: UnlistenFn | undefined;

		const syncFullscreenState = () => {
			void appWindow
				.isFullscreen()
				.then((fullscreen) => {
					if (!disposed) {
						setIsFullscreen(fullscreen);
					}
				})
				.catch((error) => {
					console.debug("Failed to query window fullscreen state", error);
				});
		};

		syncFullscreenState();

		void listen(TauriEvent.WINDOW_RESIZED, syncFullscreenState, {
			target: { kind: "Window", label: appWindow.label },
		}).then((cleanup) => {
			if (disposed) {
				cleanup();
				return;
			}
			unlisten = cleanup;
		});

		onCleanup(() => {
			disposed = true;
			unlisten?.();
		});
	});

	return isFullscreen;
}
