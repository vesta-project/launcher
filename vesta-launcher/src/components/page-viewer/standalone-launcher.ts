import {
	type MiniRouter,
	type MiniRouterSnapshot,
} from "@components/page-viewer/mini-router";
import { prepareMiniRoute } from "@components/page-viewer/mini-router-config";
import {
	createMiniWindowSessionId,
	createMiniWindowSnapshot,
	createPopOutSnapshot,
	sanitizeMiniWindowSnapshot,
} from "@components/page-viewer/mini-window-state";
import { invoke } from "@tauri-apps/api/core";
import { scheduleIdleTask } from "@utils/idle-task";

export interface MiniWindowPayload {
	snapshot: MiniRouterSnapshot;
	requestedAtMs: number;
}

export interface OpenStandaloneOptions {
	/**
	 * Stable reuse identity. Calls with the same ID reuse the same prepared window,
	 * while different IDs can remain open concurrently.
	 */
	sessionId?: string;
}

async function openSnapshot(snapshot: MiniRouterSnapshot): Promise<string> {
	const payload: MiniWindowPayload = {
		snapshot: sanitizeMiniWindowSnapshot(snapshot),
		requestedAtMs: Date.now(),
	};
	const label = await invoke<string>("launch_window", {
		sessionId: snapshot.sessionId,
		payload,
	});
	// Refill the standby pool after this claim without competing with the
	// requested window's first paint.
	scheduleIdleTask(() => {
		void invoke("prime_mini_window").catch((error) => {
			console.warn("Failed to replenish mini-window standby pool:", error);
		});
	});
	return label;
}

const requestedRoutePreloads = new Set<string>();

/**
 * Warm both the current webview and any prepared standalone webviews when the
 * user signals intent (hover/focus). Repeated calls are intentionally cheap.
 */
export function preloadMiniPage(path: string): void {
	void prepareMiniRoute(path).catch((error) => {
		console.warn(`Failed to preload mini route ${path}:`, error);
	});
	if (requestedRoutePreloads.has(path)) return;
	requestedRoutePreloads.add(path);
	void invoke("preload_mini_window_route", { path }).catch((error) => {
		requestedRoutePreloads.delete(path);
		console.warn(`Failed to prioritize standalone route ${path}:`, error);
	});
}

export async function openStandaloneMiniPage(
	path: string,
	params?: Record<string, unknown>,
	props?: Record<string, unknown>,
	options: OpenStandaloneOptions = {},
): Promise<string> {
	const sessionId =
		options.sessionId ?? createMiniWindowSessionId(path, params);
	return await openSnapshot(
		createMiniWindowSnapshot(sessionId, path, params ?? {}, props),
	);
}

export async function popOutMiniRouter(
	miniRouter: MiniRouter,
): Promise<string> {
	return await openSnapshot(createPopOutSnapshot(miniRouter.exportSnapshot()));
}
