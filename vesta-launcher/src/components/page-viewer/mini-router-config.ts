import { CreateMiniRouterPath } from "@components/page-viewer/mini-router";
import InvalidPage from "@components/pages/mini-pages/404-page";
import { waitForIdleTask } from "@utils/idle-task";
import { type Component, lazy } from "solid-js";

type RouteModule = { default: Component<any> };
type RouteLoader = () => Promise<RouteModule>;

function memoizeRouteLoader(loader: RouteLoader): RouteLoader {
	let pending: Promise<RouteModule> | undefined;
	return () => (pending ??= loader());
}

const routeLoaders: Record<string, RouteLoader> = {
	"/config": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/settings/settings-page"),
	),
	"/changelog": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/changelog/changelog"),
	),
	"/install": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/install/install-page"),
	),
	"/install/source": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/install/source-select-page"),
	),
	"/install/import": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/install/import-page"),
	),
	"/modding-guide": memoizeRouteLoader(() =>
		import("../pages/mini-pages/modding-guide/guide").then((module) => ({
			default: module.ModdingGuidePage,
		})),
	),
	"/instance": memoizeRouteLoader(
		() =>
			import("@components/pages/mini-pages/instance-details/instance-details"),
	),
	"/file-drop": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/file-drop/file-drop-page"),
	),
	"/login": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/login/login-page"),
	),
	"/resources": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/resources/resource-browser"),
	),
	"/resource-details": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/resources/resource-details"),
	),
	"/notification-test": memoizeRouteLoader(
		() => import("@components/pages/notification-test/notification-test"),
	),
	"/task-test": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/task-test/task-test-page"),
	),
	"/debug-test": memoizeRouteLoader(
		() => import("@components/pages/mini-pages/debug-test"),
	),
};

const routeComponent = (path: string) => lazy(() => routeLoaders[path]!());

const ChangelogPage = routeComponent("/changelog");
const DebugTestPage = routeComponent("/debug-test");
const FileDropPage = routeComponent("/file-drop");
const ImportPage = routeComponent("/install/import");
const InstallPage = routeComponent("/install");
const SourceSelectPage = routeComponent("/install/source");
const InstanceDetailsPage = routeComponent("/instance");
const LoginPage = routeComponent("/login");
const ResourceBrowser = routeComponent("/resources");
const ResourceDetailsPage = routeComponent("/resource-details");
const SettingsPage = routeComponent("/config");
const TaskTestPage = routeComponent("/task-test");
const NotificationTestPage = routeComponent("/notification-test");
const ModdingGuidePage = routeComponent("/modding-guide");

const COMMON_MINI_ROUTES = [
	"/config",
	"/install",
	"/instance",
	"/resources",
] as const;

/**
 * Load and parse a route in this webview before it is made visible. Settings
 * also hydrates its bootstrap-backed fields, which requires no extra IPC.
 */
export async function prepareMiniRoute(
	path: string,
	options: { preloadData?: boolean } = {},
): Promise<void> {
	const loader = routeLoaders[path];
	if (!loader) return;
	await loader();
	if (path === "/config") {
		const { initSettings } = await import("@stores/settings");
		await initSettings();
	}
	if (path === "/resources" && options.preloadData) {
		const { preloadDefaultBrowseData } = await import("@stores/resources");
		await preloadDefaultBrowseData();
	}
}

/**
 * Warm common routes one idle slice at a time to avoid turning preload work
 * into a startup CPU spike. Module loader promises make repeated calls cheap.
 */
export async function prepareCommonMiniRoutes(
	priorityPath?: string,
): Promise<void> {
	const paths = priorityPath
		? [
				priorityPath,
				...COMMON_MINI_ROUTES.filter((path) => path !== priorityPath),
			]
		: [...COMMON_MINI_ROUTES];
	for (const path of paths) {
		await waitForIdleTask();
		await prepareMiniRoute(path, { preloadData: true });
	}
}

// Centralized router path configuration
export const miniRouterPaths = {
	...CreateMiniRouterPath("/config", SettingsPage, "Settings"),
	...CreateMiniRouterPath("/changelog", ChangelogPage, "Changelog"),
	...CreateMiniRouterPath("/install", InstallPage, "Install"),
	...CreateMiniRouterPath(
		"/install/source",
		SourceSelectPage,
		"Install Source",
	),
	...CreateMiniRouterPath("/install/import", ImportPage, "Launcher Import"),
	...CreateMiniRouterPath("/modding-guide", ModdingGuidePage, "Modding Guide"),
	...CreateMiniRouterPath("/instance", InstanceDetailsPage, "Instance Details"),
	...CreateMiniRouterPath("/file-drop", FileDropPage, "File Drop"),
	...CreateMiniRouterPath("/login", LoginPage, "Sign In"),
	...CreateMiniRouterPath("/resources", ResourceBrowser, "Resource Browser"),
	...CreateMiniRouterPath(
		"/resource-details",
		ResourceDetailsPage,
		"Resource Details",
	),
	...CreateMiniRouterPath(
		"/notification-test",
		NotificationTestPage,
		"Notification Test",
	),
	...CreateMiniRouterPath("/task-test", TaskTestPage, "Task System Test"),
	...CreateMiniRouterPath(
		"/debug-test",
		DebugTestPage,
		"Debug Interaction Test",
	),
};

export const miniRouterInvalidPage = InvalidPage;
