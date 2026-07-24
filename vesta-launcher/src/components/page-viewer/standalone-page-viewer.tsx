import {
	MiniRouter,
	type MiniRouterSnapshot,
} from "@components/page-viewer/mini-router";
import {
	miniRouterInvalidPage,
	miniRouterPaths,
	prepareCommonMiniRoutes,
	prepareMiniRoute,
} from "@components/page-viewer/mini-router-config";
import type { MiniWindowPayload } from "@components/page-viewer/standalone-launcher";
import { setRouter } from "@components/page-viewer/page-viewer";
import { UnifiedPageViewer } from "@components/page-viewer/unified-page-viewer";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WindowControls } from "@tauri-controls-v2/solid";
import { useOs } from "@utils/os";
import {
	afterNextPaint,
	presentCurrentWindowAfterPaint,
} from "@utils/window-readiness";
import { useWindowFullscreen } from "@utils/window-fullscreen";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import styles from "./standalone-page-viewer.module.css";

async function waitForRouteSurface(path: string): Promise<void> {
	const deadline = performance.now() + 5000;
	while (performance.now() < deadline) {
		const surface = document.querySelector<HTMLElement>(
			"[data-mini-route-ready]",
		);
		if (surface?.dataset.miniRouteReady === path) {
			return;
		}
		await afterNextPaint();
	}
	throw new Error(`Timed out waiting for mini route to paint: ${path}`);
}

function createRouter(snapshot: MiniRouterSnapshot): MiniRouter {
	const miniRouter = new MiniRouter({
		paths: miniRouterPaths,
		invalid: miniRouterInvalidPage,
		sessionId: snapshot.sessionId,
		currentPath: snapshot.current.path,
	});
	miniRouter.restoreSnapshot(snapshot);
	return miniRouter;
}

function StandalonePageViewer() {
	const osType = useOs();
	const isWindowFullscreen = useWindowFullscreen();
	const [activeRouter, setActiveRouter] = createSignal<MiniRouter>();
	const isMacosFullscreen = createMemo(
		() => osType() === "macos" && isWindowFullscreen(),
	);
	let unlistenOpen: UnlistenFn | undefined;
	let unlistenPreload: UnlistenFn | undefined;
	let applyingPayload: Promise<void> = Promise.resolve();

	const applyPendingPayload = async () => {
		const payload = await invoke<MiniWindowPayload | null>(
			"take_mini_window_payload",
		);
		if (!payload?.snapshot) {
			void prepareCommonMiniRoutes().catch((error) => {
				console.warn("Failed to warm standalone routes:", error);
			});
			return;
		}

		await prepareMiniRoute(payload.snapshot.current.path);

		let miniRouter = activeRouter();
		if (!miniRouter || miniRouter.sessionId !== payload.snapshot.sessionId) {
			miniRouter = createRouter(payload.snapshot);
			setActiveRouter(miniRouter);
			setRouter(miniRouter);
		} else {
			miniRouter.restoreSnapshot(payload.snapshot);
		}

		await waitForRouteSurface(payload.snapshot.current.path);
		await presentCurrentWindowAfterPaint();
		console.debug("[mini-window-performance]", {
			path: payload.snapshot.current.path,
			readyMs: Date.now() - payload.requestedAtMs,
		});
		void prepareCommonMiniRoutes(payload.snapshot.current.path).catch(
			(error) => {
				console.warn("Failed to warm remaining standalone routes:", error);
			},
		);
	};

	const queuePayloadApplication = () => {
		applyingPayload = applyingPayload
			.then(applyPendingPayload)
			.catch((error) =>
				console.error("Failed to open mini-window payload:", error),
			);
	};

	const requestHide = async () => {
		const miniRouter = activeRouter();
		const canExit = miniRouter?.getCanExit();
		if (canExit && !(await canExit())) return;
		await invoke("hide_mini_window");
	};

	onMount(async () => {
		unlistenOpen = await listen("core://mini-window-open", () => {
			queuePayloadApplication();
		});
		unlistenPreload = await listen<string>(
			"core://mini-window-preload",
			(event) => {
				void prepareMiniRoute(event.payload).catch((error) => {
					console.warn(
						`Failed to preload standalone route ${event.payload}:`,
						error,
					);
				});
			},
		);

		const unlistenCloseRequested = await getCurrentWindow().onCloseRequested(
			(event) => {
				event.preventDefault();
				void requestHide();
			},
		);

		onCleanup(() => {
			unlistenCloseRequested();
		});

		queuePayloadApplication();
	});

	onCleanup(() => {
		unlistenOpen?.();
		unlistenPreload?.();
	});

	return (
		<Show when={activeRouter()}>
			{(miniRouter) => (
				<UnifiedPageViewer
					router={miniRouter()}
					showWindowControls={true}
					titleSuffix="Standalone"
					os={osType()}
					macosFullscreen={isMacosFullscreen()}
					onClose={() => void requestHide()}
					windowControls={
						<Show when={osType() !== "macos"}>
							<WindowControls
								class={
									styles["standalone-page-viewer__controls"] +
									styles[
										`standalone-page-viewer__controls--${osType() ?? "windows"}`
									]
								}
								platform={
									osType() === "linux"
										? "gnome"
										: osType() === "macos"
											? "macos"
											: "windows"
								}
							/>
						</Show>
					}
				/>
			)}
		</Show>
	);
}

export default StandalonePageViewer;
