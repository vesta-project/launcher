import { FatalPage, setFatalInfo } from "@components/pages/fatal/fatal-page";
import InitPage from "@components/pages/init/init";
import InvalidPage from "@components/pages/invalid/invalid";
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
		unlisten = await listen<{
			title: string;
			description: string;
		}>("core://crash", (event) => {
			console.log("Crash");
			setFatalInfo(event.payload);
			navigate("/fatal", { replace: true });
		});

		// Setup notification system (non-blocking)
		subscribeToBackendNotifications().catch((error) => {
			console.error("Failed to initialize notification system:", error);
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

	return <>{props.children}</>;
}

export default App;
