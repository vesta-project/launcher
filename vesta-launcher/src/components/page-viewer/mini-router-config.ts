import { CreateMiniRouterPath } from "@components/page-viewer/mini-router";
import InvalidPage from "@components/pages/mini-pages/404-page";
import { lazy } from "solid-js";

const ChangelogPage = lazy(
	() => import("@components/pages/mini-pages/changelog/changelog"),
);
const DebugTestPage = lazy(
	() => import("@components/pages/mini-pages/debug-test"),
);
const FileDropPage = lazy(
	() => import("@components/pages/mini-pages/file-drop/file-drop-page"),
);
const ImportPage = lazy(
	() => import("@components/pages/mini-pages/install/import-page"),
);
const InstallPage = lazy(
	() => import("@components/pages/mini-pages/install/install-page"),
);
const SourceSelectPage = lazy(
	() => import("@components/pages/mini-pages/install/source-select-page"),
);
const InstanceDetailsPage = lazy(
	() =>
		import("@components/pages/mini-pages/instance-details/instance-details"),
);
const LoginPage = lazy(
	() => import("@components/pages/mini-pages/login/login-page"),
);
const ResourceBrowser = lazy(
	() => import("@components/pages/mini-pages/resources/resource-browser"),
);
const ResourceDetailsPage = lazy(
	() => import("@components/pages/mini-pages/resources/resource-details"),
);
const SettingsPage = lazy(
	() => import("@components/pages/mini-pages/settings/settings-page"),
);
const TaskTestPage = lazy(
	() => import("@components/pages/mini-pages/task-test/task-test-page"),
);
const NotificationTestPage = lazy(
	() => import("@components/pages/notification-test/notification-test"),
);
const ModdingGuidePage = lazy(() =>
	import("../pages/mini-pages/modding-guide/guide").then((module) => ({
		default: module.ModdingGuidePage,
	})),
);

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
