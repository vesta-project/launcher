import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import { MiniRouter } from "@components/page-viewer/mini-router";
import {
	canResumeRouteFromLibrary,
	createFlatShellNavigation,
	createLibraryEntry,
	futureEntryMatchesTarget,
	handleNavigationBack,
	handleNavigationForward,
	isLibraryPath,
	LIBRARY_PATH,
	routeParamsMatch,
} from "@utils/flat-shell-navigation";

function createTestRouter() {
	const router = new MiniRouter({
		paths: {
			"/config": { element: () => null, name: "Settings" },
			"/install": { element: () => null, name: "Install" },
			"/instance": { element: () => null, name: "Instance" },
		},
	});

	const [pageViewerOpen, setPageViewerOpen] = createSignal(false);
	router.setShellNavigation(createFlatShellNavigation(pageViewerOpen, setPageViewerOpen));

	return { router, pageViewerOpen, setPageViewerOpen };
}

describe("library sentinel helpers", () => {
	it("creates and identifies library entries", () => {
		const entry = createLibraryEntry();
		expect(entry.path).toBe(LIBRARY_PATH);
		expect(isLibraryPath(LIBRARY_PATH)).toBe(true);
	});
});

describe("routeParamsMatch", () => {
	it("matches numeric and string param values", () => {
		expect(routeParamsMatch({ id: 5 }, { id: "5" })).toBe(true);
	});

	it("rejects different params", () => {
		expect(routeParamsMatch({ activeTab: "help" }, { activeTab: "account" })).toBe(false);
	});
});

describe("canResumeRouteFromLibrary", () => {
	it("resumes the same instance even when the stored route has extra query params", () => {
		expect(
			canResumeRouteFromLibrary("/instance", { id: 5, activeTab: "console" }, { id: 5 }),
		).toBe(true);
	});

	it("does not resume a different instance", () => {
		expect(canResumeRouteFromLibrary("/instance", { id: 5 }, { id: 6 })).toBe(false);
	});
});

describe("library slot navigation", () => {
	it("opens a page from library with library in past", () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.setLibrarySlot();

		router.navigateFromLibrary("/instance", { id: 1 });

		expect(pageViewerOpen()).toBe(true);
		expect(router.currentPath.get()).toBe("/instance");
		expect(router.isOnLibrarySlot()).toBe(false);
		expect(router.history.past).toEqual([createLibraryEntry()]);
		expect(router.history.future).toEqual([]);
	});

	it("returns to library in one back from a page opened from library", async () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/instance", { id: 1 });

		await handleNavigationBack(router);

		expect(pageViewerOpen()).toBe(false);
		expect(router.isOnLibrarySlot()).toBe(true);
		expect(router.history.past).toEqual([]);
		expect(router.history.future[0]?.path).toBe("/instance");
	});

	it("A → library → B → back returns to library not A", async () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/instance", { id: 1 });
		router.navigateToLibrary();

		expect(pageViewerOpen()).toBe(false);
		expect(router.canGoBack()).toBe(true);
		expect(router.history.past[router.history.past.length - 1]?.params).toEqual({ id: 1 });

		router.navigateFromLibrary("/instance", { id: 2 });

		expect(router.history.past).toEqual([createLibraryEntry()]);
		expect(router.history.future).toEqual([]);

		await handleNavigationBack(router);

		expect(pageViewerOpen()).toBe(false);
		expect(router.isOnLibrarySlot()).toBe(true);
		expect(router.history.future[0]?.params).toEqual({ id: 2 });
	});

	it("A → library → back resumes A", async () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/instance", { id: 1 });
		router.navigateToLibrary();

		expect(router.canGoBack()).toBe(true);
		expect(router.canGoForward()).toBe(false);
		await handleNavigationBack(router);

		expect(pageViewerOpen()).toBe(true);
		expect(router.currentPath.get()).toBe("/instance");
		expect(router.currentParams.get()).toEqual({ id: 1 });
		expect(router.history.past).toEqual([createLibraryEntry()]);
	});

	it("A → library → B clears forward to A", () => {
		const { router } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/instance", { id: 1 });
		router.navigateToLibrary();

		router.navigateFromLibrary("/instance", { id: 2 });

		expect(router.history.future).toEqual([]);
	});

	it("preserves dismissed page state in past when dismissing to library", () => {
		const { router } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/instance", { id: 1 });
		router.updateQuery("activeTab", "console", true);

		router.navigateToLibrary();

		expect(router.isOnLibrarySlot()).toBe(true);
		expect(router.canGoBack()).toBe(true);
		expect(router.history.future).toEqual([]);
		expect(router.history.past[router.history.past.length - 1]?.params.activeTab).toBe("console");
	});

	it("library tab back resumes the current page not the first in-app page", async () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/config");
		router.navigate("/install");

		router.navigateToLibrary();

		expect(pageViewerOpen()).toBe(false);
		expect(router.isOnLibrarySlot()).toBe(true);
		expect(router.canGoBack()).toBe(true);

		await handleNavigationBack(router);
		expect(router.currentPath.get()).toBe("/install");
		expect(router.history.past.map((e) => e.path)).toEqual([LIBRARY_PATH, "/config"]);
	});

	it("restores in-page back history after library dismiss and back", async () => {
		const { router } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/instance", { id: 8 });
		router.updateQuery("activeTab", "settings", true);
		router.navigate("/config");
		router.navigate("/resources");

		router.navigateToLibrary();

		expect(router.canGoBack()).toBe(true);
		expect(router.history.past.map((e) => e.path)).toEqual([
			LIBRARY_PATH,
			"/instance",
			"/instance",
			"/config",
			"/resources",
		]);

		await handleNavigationBack(router);

		expect(router.currentPath.get()).toBe("/resources");
		expect(router.history.past.map((e) => e.path)).toEqual([
			LIBRARY_PATH,
			"/instance",
			"/instance",
			"/config",
		]);

		router.backwards();
		expect(router.currentPath.get()).toBe("/config");
	});

	it("A → tab → library → B → back returns to library", async () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/instance", { id: 1 });
		router.updateQuery("activeTab", "console", true);
		router.navigateToLibrary();
		router.navigateFromLibrary("/instance", { id: 2 });

		await handleNavigationBack(router);

		expect(pageViewerOpen()).toBe(false);
		expect(router.isOnLibrarySlot()).toBe(true);
	});

	it("resuming the same instance from library uses back without duplicating history", async () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/instance", { id: 5 });
		router.navigateToLibrary();

		const pastEntry = router.history.past[router.history.past.length - 1];
		expect(pastEntry).toBeDefined();
		expect(futureEntryMatchesTarget(pastEntry!, "/instance", { id: 5 })).toBe(true);

		await handleNavigationBack(router);

		expect(pageViewerOpen()).toBe(true);
		expect(router.history.past.map((e) => e.path)).toEqual([LIBRARY_PATH]);
		expect(router.history.future[0]?.path).toBe(LIBRARY_PATH);
	});

	it("does not clear back history when library is clicked while already on library", () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/instance", { id: 1 });
		router.navigateToLibrary();

		expect(router.canGoBack()).toBe(true);
		const pastBefore = router.history.past.length;

		router.navigateToLibrary();

		expect(pageViewerOpen()).toBe(false);
		expect(router.isOnLibrarySlot()).toBe(true);
		expect(router.canGoBack()).toBe(true);
		expect(router.history.past).toHaveLength(pastBefore);
		expect(router.history.past[router.history.past.length - 1]?.params).toEqual({ id: 1 });
	});

	it("walks in-page history before returning to library", async () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.setLibrarySlot();
		router.navigateFromLibrary("/config");
		router.navigate("/install");

		router.backwards();
		expect(router.currentPath.get()).toBe("/config");
		expect(pageViewerOpen()).toBe(true);

		await handleNavigationBack(router);
		expect(pageViewerOpen()).toBe(false);
		expect(router.isOnLibrarySlot()).toBe(true);
	});

	it("library tab without sentinel still resumes only the current page", async () => {
		const { router, pageViewerOpen } = createTestRouter();
		router.navigate("/config");
		router.navigate("/install");

		router.navigateToLibrary();

		expect(pageViewerOpen()).toBe(false);
		expect(router.isOnLibrarySlot()).toBe(true);
		expect(router.canGoBack()).toBe(true);
		expect(router.history.past[router.history.past.length - 1]?.path).toBe("/install");

		await handleNavigationBack(router);
		expect(router.currentPath.get()).toBe("/install");
	});

	it("seeds library in past when opening from closed viewer without prior library slot", () => {
		const { router, pageViewerOpen } = createTestRouter();
		expect(router.isOnLibrarySlot()).toBe(false);

		router.navigateFromLibrary("/instance", { id: 1 });

		expect(pageViewerOpen()).toBe(true);
		expect(router.history.past).toEqual([createLibraryEntry()]);
	});
});

describe("resetLibrarySlot", () => {
	it("strips library entries but keeps real page history", () => {
		const { router } = createTestRouter();
		router.navigate("/config");
		router.navigate("/install");
		router.navigateToLibrary();

		expect(router.history.past.some((entry) => entry.path === LIBRARY_PATH)).toBe(false);
		expect(router.history.past.length).toBeGreaterThan(0);

		router.resetLibrarySlot();

		expect(router.isOnLibrarySlot()).toBe(false);
		expect(router.history.past.map((entry) => entry.path)).toEqual(["/config", "/install"]);
		expect(router.history.future).toEqual([]);
	});

	it("does not clear history when leaving flat mode on a real page", () => {
		const { router } = createTestRouter();
		router.navigateFromLibrary("/config");
		router.navigate("/install");

		router.resetLibrarySlot();

		expect(router.currentPath.get()).toBe("/install");
		expect(router.history.past.map((entry) => entry.path)).toEqual(["/config"]);
	});
});
