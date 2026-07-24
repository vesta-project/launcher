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
 * Give a router snapshot a window identity based on the view it currently
 * represents. A MiniRouter's own session ID belongs to the in-window tab
 * history, so using it as the native window identity would collapse every
 * popped-out route from that router into one window.
 */
export function createPopOutSnapshot(
	snapshot: MiniRouterSnapshot,
	sessionId = createMiniWindowSessionId(
		snapshot.current.path,
		snapshot.current.params,
	),
): MiniRouterSnapshot {
	return {
		...snapshot,
		sessionId,
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
