import type { MiniRouterSnapshot } from "@components/page-viewer/mini-router";

const ROUTE_IDENTITY_KEYS = [
	"id",
	"slug",
	"projectId",
	"platform",
	"source",
] as const;

/**
 * Derive a stable logical window identity while still allowing callers to
 * provide their own session ID when multiple copies of one route are useful.
 */
export function createMiniWindowSessionId(
	path: string,
	params: Record<string, unknown> = {},
): string {
	const identity = ROUTE_IDENTITY_KEYS.flatMap((key) =>
		params[key] == null || params[key] === ""
			? []
			: [`${key}:${String(params[key])}`],
	).join("|");
	return identity ? `${path}|${identity}` : path;
}

export function createMiniWindowSnapshot(
	sessionId: string,
	path: string,
	params: Record<string, unknown> = {},
	props?: Record<string, unknown>,
): MiniRouterSnapshot {
	return {
		version: 1,
		sessionId,
		current: { path, params, props },
		past: [],
		future: [],
		customName: null,
	};
}

/**
 * IPC snapshots intentionally contain only serializable view state. Runtime
 * callbacks and router references are recreated inside the destination window.
 */
export function sanitizeMiniWindowSnapshot(
	snapshot: MiniRouterSnapshot,
): MiniRouterSnapshot {
	const seen = new WeakSet<object>();
	const json = JSON.stringify(snapshot, (key, candidate) => {
		if (
			key === "router" ||
			key === "close" ||
			key === "setRefetch" ||
			typeof candidate === "function" ||
			typeof candidate === "symbol"
		) {
			return undefined;
		}
		if (candidate && typeof candidate === "object") {
			if (seen.has(candidate)) return undefined;
			seen.add(candidate);
		}
		return candidate;
	});
	return JSON.parse(json) as MiniRouterSnapshot;
}
