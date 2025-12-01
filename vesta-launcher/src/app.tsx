import { FatalPage, setFatalInfo } from "@components/pages/fatal/fatal-page";
import InitPage from "@components/pages/init/init";
import InvalidPage from "@components/pages/invalid";
import { Route, Router, useNavigate, useSearchParams } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { UnlistenFn, emit, listen } from "@tauri-apps/api/event";
import { ChildrenProp } from "@ui/props";
import {
	applyCommonConfigUpdates,
	onConfigUpdate,
	subscribeToConfigUpdates,
	unsubscribeFromConfigUpdates,
} from "@utils/config-sync";
import {
	cleanupNotifications,
	subscribeToBackendNotifications,
	unsubscribeFromBackendNotifications,
} from "@utils/notifications";
import { getMinecraftVersions } from "@utils/instances";
import { lazy, onCleanup, onMount } from "solid-js";
// import { initializeFileDropSystem, cleanupFileDropSystem } from "@utils/file-drop";

const HomePage = lazy(() => import("@components/pages/home/home"));
const StandalonePageViewer = lazy(
	() => import("@components/page-viewer/standalone-page-viewer"),
);

function App() {
	/*
    setInterval(() => {
        console.log(document.activeElement)
    }, 1000)*/

	return (
		<>
			<Router root={Root}>
				<Route path="/" component={InitPage} />
				<Route path={"/home"} component={HomePage} />
				<Route path="*404" component={InvalidPage} />
				<Route path={"/fatal"} component={FatalPage} />
				<Route path={"/other.html"} component={HomePage} />
				<Route path={"/standalone"} component={StandalonePageViewer} />
			</Router>
		</>
	);
}

function Root(props: ChildrenProp) {
	const navigate = useNavigate();

	let unlisten: UnlistenFn | null = null;

	onMount(async () => {
		// Critical: Setup crash handler immediately
		unlisten = await listen<{
			title: string;
			description: string;
		}>("core://crash", (event) => {
			console.log("Crash");
			setFatalInfo(event.payload);
			navigate("/fatal", { replace: true });
		});

		// Defer non-critical initialization to not block UI render
		// This allows the window to show immediately while background tasks start
		setTimeout(() => {
			// Setup notification system (non-blocking)
			subscribeToBackendNotifications().catch((error) => {
				console.error("Failed to initialize notification system:", error);
			});

			// Preload Minecraft versions metadata in background (non-blocking)
			// This warms up the cache so install page loads instantly
			getMinecraftVersions()
				.then(() => {
					console.log("Preloaded Minecraft versions metadata");
				})
				.catch((error) => {
					// Silent fail - install page will fetch on demand if preload fails
					console.warn("Failed to preload Minecraft versions:", error);
				});

			// Cleanup notifications in background (don't block startup)
			cleanupNotifications()
				.then((cleaned) => {
					if (cleaned > 0) {
						console.log(`Cleaned up ${cleaned} expired notifications`);
					}
				})
				.catch((error) => {
					console.error("Failed to cleanup notifications:", error);
				});

			// Setup config sync system (non-blocking)
			subscribeToConfigUpdates()
				.then(() => {
					onConfigUpdate(applyCommonConfigUpdates);
				})
				.catch((error) => {
					console.error("Failed to initialize config sync:", error);
				});
		}, 100); // 100ms delay to ensure UI renders first

		// File drop system disabled for now
		// try {
		// 	await initializeFileDropSystem();
		// } catch (error) {
		// 	console.error("Failed to initialize file drop system:", error);
		// }
	});

	onCleanup(() => {
		unlisten?.();
		unsubscribeFromBackendNotifications();
		unsubscribeFromConfigUpdates();
		// cleanupFileDropSystem();
	});

	// Hide loader after app renders
	setTimeout(() => {
		const loader = document.getElementById("app-loader");
		if (loader) {
			loader.classList.add("hidden");
			setTimeout(() => loader.remove(), 300);
		}
	}, 100);

	return <>{props.children}</>;
}

export default App;
