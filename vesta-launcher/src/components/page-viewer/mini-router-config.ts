import { CreateMiniRouterPath } from "@components/page-viewer/mini-router";
import InvalidPage from "@components/pages/mini-pages/404-page";
import FileDropPage from "@components/pages/mini-pages/file-drop/file-drop-page";
import InstallPage from "@components/pages/mini-pages/install/install-page";
import InstanceDetailsPage from "@components/pages/mini-pages/instance-details/instance-details";
import LoginPage from "@components/pages/mini-pages/login/login-page";
import ResourceBrowser from "@components/pages/mini-pages/resources/resource-browser";
import ResourceDetailsPage from "@components/pages/mini-pages/resources/resource-details";
import SettingsPage from "@components/pages/mini-pages/settings/settings-page";
import TaskTestPage from "@components/pages/mini-pages/task-test/task-test-page";
import NotificationTestPage from "@components/pages/notification-test/notification-test";
import { ModdingGuidePage } from "../pages/mini-pages/modding-guide/guide";

// Centralized router path configuration
export const miniRouterPaths = {
	...CreateMiniRouterPath("/config", SettingsPage, "Settings"),
	...CreateMiniRouterPath("/install", InstallPage, "Install"),
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
};

export const miniRouterInvalidPage = InvalidPage;
