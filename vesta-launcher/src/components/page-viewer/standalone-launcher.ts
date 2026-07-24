import {
	type MiniRouter,
	type MiniRouterSnapshot,
} from "@components/page-viewer/mini-router";
import {
	createMiniWindowSessionId,
	createMiniWindowSnapshot,
	sanitizeMiniWindowSnapshot,
} from "@components/page-viewer/mini-window-state";
import { invoke } from "@tauri-apps/api/core";

export interface MiniWindowPayload {
	snapshot: MiniRouterSnapshot;
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
	};
	return await invoke<string>("launch_window", {
		sessionId: snapshot.sessionId,
		payload,
	});
}

export async function openStandaloneMiniPage(
	path: string,
	params?: Record<string, unknown>,
	props?: Record<string, unknown>,
	options: OpenStandaloneOptions = {},
): Promise<string> {
	const sessionId = options.sessionId ?? createMiniWindowSessionId(path, params);
	return await openSnapshot(
		createMiniWindowSnapshot(sessionId, path, params ?? {}, props),
	);
}

export async function popOutMiniRouter(
	miniRouter: MiniRouter,
): Promise<string> {
	return await openSnapshot(miniRouter.exportSnapshot());
}
