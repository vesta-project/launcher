import type { Accessor } from "solid-js";

export const LIBRARY_PATH = "__library__";

export interface HistoryEntry {
	path: string;
	params: Record<string, unknown>;
	props: Record<string, unknown> | undefined;
}

export interface ShellNavigationDelegate {
	onEnterLibrary: () => void;
	onLeaveLibrary: () => void;
}

/** Subset of MiniRouter used by shared back/forward handlers. */
export interface FlatNavigationRouter {
	canGoBack(): boolean;
	canGoForward(): boolean;
	getCanExit(): (() => Promise<boolean>) | null;
	backwards(): void;
	forwards(): void;
}

export function createLibraryEntry(): HistoryEntry {
	return { path: LIBRARY_PATH, params: {}, props: undefined };
}

export function isLibraryEntry(entry: HistoryEntry): boolean {
	return entry.path === LIBRARY_PATH;
}

export function isLibraryPath(path: string): boolean {
	return path === LIBRARY_PATH;
}

export function createFlatShellNavigation(
	pageViewerOpen: Accessor<boolean>,
	setPageViewerOpen: (open: boolean) => void,
): ShellNavigationDelegate {
	return {
		onEnterLibrary: () => {
			if (pageViewerOpen()) setPageViewerOpen(false);
		},
		onLeaveLibrary: () => {
			if (!pageViewerOpen()) setPageViewerOpen(true);
		},
	};
}

function normalizeParamValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

export function routeParamsMatch(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
	options?: { ignoreKeys?: string[] },
): boolean {
	const ignore = new Set(options?.ignoreKeys ?? []);
	const keys = new Set(
		[...Object.keys(a), ...Object.keys(b)].filter((key) => !ignore.has(key)),
	);

	for (const key of keys) {
		if (normalizeParamValue(a[key]) !== normalizeParamValue(b[key]))
			return false;
	}

	return true;
}

function instanceRouteIdentity(params: Record<string, unknown>): string | null {
	if (params.id != null && params.id !== "") {
		return `id:${normalizeParamValue(params.id)}`;
	}
	if (params.slug != null && params.slug !== "") {
		return `slug:${normalizeParamValue(params.slug)}`;
	}
	return null;
}

export function isSameInstanceRoute(
	currentParams: Record<string, unknown>,
	targetParams: Record<string, unknown>,
): boolean {
	const currentIdentity = instanceRouteIdentity(currentParams);
	const targetIdentity = instanceRouteIdentity(targetParams);
	if (!currentIdentity || !targetIdentity) {
		return routeParamsMatch(currentParams, targetParams, {
			ignoreKeys: ["activeTab"],
		});
	}
	return currentIdentity === targetIdentity;
}

function resourceDetailsRouteIdentity(
	params: Record<string, unknown>,
): string | null {
	if (params.projectId == null || params.platform == null) return null;
	return `${normalizeParamValue(params.platform)}:${normalizeParamValue(params.projectId)}`;
}

export function canResumeRouteFromLibrary(
	path: string,
	currentParams: Record<string, unknown>,
	targetParams: Record<string, unknown>,
): boolean {
	switch (path) {
		case "/instance": {
			const currentIdentity = instanceRouteIdentity(currentParams);
			const targetIdentity = instanceRouteIdentity(targetParams);
			const ignoreActiveTab = targetParams.activeTab == null;
			const ignoreKeys = ignoreActiveTab ? ["activeTab"] : [];

			if (!currentIdentity || !targetIdentity) {
				return routeParamsMatch(currentParams, targetParams, { ignoreKeys });
			}
			if (currentIdentity !== targetIdentity) {
				return false;
			}
			return routeParamsMatch(currentParams, targetParams, { ignoreKeys });
		}
		case "/resource-details": {
			const currentIdentity = resourceDetailsRouteIdentity(currentParams);
			const targetIdentity = resourceDetailsRouteIdentity(targetParams);
			if (!currentIdentity || !targetIdentity) {
				return routeParamsMatch(currentParams, targetParams);
			}
			return currentIdentity === targetIdentity;
		}
		case "/config":
			if (targetParams.activeTab != null) {
				return routeParamsMatch(currentParams, targetParams);
			}
			return routeParamsMatch(currentParams, targetParams, {
				ignoreKeys: ["activeTab"],
			});
		case "/resources":
			return routeParamsMatch(currentParams, targetParams, {
				ignoreKeys: ["activeTab"],
			});
		default:
			return routeParamsMatch(currentParams, targetParams);
	}
}

export function futureEntryMatchesTarget(
	entry: HistoryEntry,
	path: string,
	targetParams: Record<string, unknown>,
): boolean {
	if (entry.path !== path || isLibraryEntry(entry)) return false;
	return canResumeRouteFromLibrary(path, entry.params, targetParams);
}

export async function handleNavigationBack(
	router: FlatNavigationRouter,
): Promise<void> {
	if (!router.canGoBack()) return;

	const canExit = router.getCanExit();
	if (canExit) {
		const ok = await canExit();
		if (!ok) return;
	}

	router.backwards();
}

export function handleNavigationForward(router: FlatNavigationRouter): void {
	if (!router.canGoForward()) return;
	router.forwards();
}

export async function handleNavigationKeyDown(
	event: KeyboardEvent,
	router: FlatNavigationRouter | undefined,
): Promise<void> {
	if (!router || !event.altKey) return;

	if (event.key === "ArrowLeft") {
		event.preventDefault();
		await handleNavigationBack(router);
	}

	if (event.key === "ArrowRight") {
		event.preventDefault();
		handleNavigationForward(router);
	}
}
