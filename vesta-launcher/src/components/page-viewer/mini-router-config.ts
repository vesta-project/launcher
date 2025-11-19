import { CreateMiniRouterPath } from "@components/page-viewer/mini-router";
import InvalidPage from "@components/pages/mini-pages/404/404-page";
import InstallPage from "@components/pages/mini-pages/install/install-page";
import SettingsPage from "@components/pages/mini-pages/settings/settings-page";
import FileDropPage from "@components/pages/mini-pages/file-drop/file-drop-page";
import NotificationTestPage from "@components/pages/notification-test/notification-test";

// Centralized router path configuration
export const miniRouterPaths = {
	...CreateMiniRouterPath("/config", SettingsPage, "Settings"),
	...CreateMiniRouterPath("/install", InstallPage, "Install"),
	...CreateMiniRouterPath("/file-drop", FileDropPage, "File Drop"),
	...CreateMiniRouterPath("/notification-test", NotificationTestPage, "Notification Test"),
};

export const miniRouterInvalidPage = InvalidPage;
