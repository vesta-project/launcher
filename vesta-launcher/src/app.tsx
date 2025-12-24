import { FatalPage, setFatalInfo } from "@components/pages/fatal/fatal-page";
// import { initializeFileDropSystem, cleanupFileDropSystem } from "@utils/file-drop";
import HomePage from "@components/pages/home/home";
import InitPage from "@components/pages/init/init";
import InvalidPage from "@components/pages/invalid";
import { Route, Router, useNavigate, useSearchParams } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { ChildrenProp } from "@ui/props";
import {
	applyCommonConfigUpdates,
	applyConfigSnapshot,
	onConfigUpdate,
	subscribeToConfigUpdates,
	unsubscribeFromConfigUpdates,
} from "@utils/config-sync";
import { getMinecraftVersions } from "@utils/instances";
import {
	cleanupNotifications,
	subscribeToBackendNotifications,
	unsubscribeFromBackendNotifications,
} from "@utils/notifications";
import {
	subscribeToCrashEvents,
} from "@utils/crash-handler";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { lazy, onCleanup, onMount } from "solid-js";

const StandalonePageViewer = lazy(
	() => import("@components/page-viewer/standalone-page-viewer"),
);

/**
 * Handles deep-link URLs like vesta://instance?slug=my-instance
 * Parses the URL and navigates to the appropriate page
 */
function handleDeepLink(url: string, navigate: ReturnType<typeof useNavigate>) {
	try {
		// Parse URL: vesta://path?param1=value1&param2=value2
		const urlObj = new URL(url);
		const path = urlObj.hostname; // In vesta://instance, hostname is "instance"
		const searchParams = urlObj.searchParams;

		console.log("Deep link parsed:", {
			path,
			params: Object.fromEntries(searchParams),
		});

		// Navigate to standalone page viewer with path and params
		// The standalone page viewer will handle the mini-router navigation
		const params = new URLSearchParams();
		params.set("path", path);

		// Add all query parameters
		for (const [key, value] of searchParams) {
			params.set(key, value);
		}

		navigate(`/standalone?${params.toString()}`);
	} catch (error) {
		console.error("Failed to parse deep link:", url, error);
	}
}

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
	let unlistenDeepLink: (() => void) | null = null;
	let unlistenCrash: (() => void) | null = null;

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

		// Setup deep-link handler for vesta:// URLs
		try {
			unlistenDeepLink = await onOpenUrl((urls) => {
				console.log("Deep link received:", urls);

				// Handle the first URL in the array
				if (urls && urls.length > 0) {
					const url = urls[0];
					handleDeepLink(url, navigate);
				}
			});
		} catch (error) {
			console.error("Failed to setup deep-link handler:", error);
		}

		// Defer non-critical initialization to not block UI render
		// This allows the window to show immediately while background tasks start
		setTimeout(() => {
			// Setup notification system (non-blocking)
			subscribeToBackendNotifications().catch((error) => {
				console.error("Failed to initialize notification system:", error);
			});

			// Setup crash event listener (non-blocking)
			subscribeToCrashEvents()
				.then((unlisten) => {
					unlistenCrash = unlisten;
					console.log("Crash event listener subscribed");
				})
				.catch((error) => {
					console.error("Failed to initialize crash event listener:", error);
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
				.then(async () => {
					onConfigUpdate(applyCommonConfigUpdates);

					if (hasTauriRuntime()) {
						try {
							const config = await invoke("get_config");
							applyConfigSnapshot(config as Record<string, any>);
						} catch (error) {
							console.error("Failed to apply initial config:", error);
						}
					}
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
		unlistenDeepLink?.();
		unlistenCrash?.();
		unsubscribeFromBackendNotifications();
		unsubscribeFromConfigUpdates();
		// cleanupFileDropSystem();
	});

	// Hide loader on first paint rather than a fixed timeout
	requestAnimationFrame(() => {
		const loader = document.getElementById("app-loader");
		if (loader) {
			loader.classList.add("hidden");
			setTimeout(() => loader.remove(), 300);
		}
	});

	return <>{props.children}</>;
}

export default App;
