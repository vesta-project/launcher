import { FatalPage, setFatalInfo } from "@components/pages/fatal/fatal-page";
import {
	initializeFileDropSystem,
	cleanupFileDropSystem,
	getDropZoneManager,
} from "@utils/file-drop";
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
import { subscribeToCrashEvents } from "@utils/crash-handler";
import { getMinecraftVersions } from "@utils/instances";
import {
	cleanupNotifications,
	subscribeToBackendNotifications,
	unsubscribeFromBackendNotifications,
} from "@utils/notifications";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createSignal, lazy, onCleanup, onMount } from "solid-js";
import { initializeInstances, setupInstanceListeners } from "@stores/instances";
import { ConfirmExitDialog } from "@components/confirm-exit-dialog";

const StandalonePageViewer = lazy(
	() => import("@components/page-viewer/standalone-page-viewer"),
);

export interface ExitCheckResponse {
	can_exit: boolean;
	blocking_tasks: string[];
	running_instances: string[];
}


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

	const [exitDialogOpen, setExitDialogOpen] = createSignal(false);
	const [blockingTasks, setBlockingTasks] = createSignal<string[]>([]);
	const [runningInstances, setRunningInstances] = createSignal<string[]>([]);

	let unlisten: UnlistenFn | null = null;
	let unlistenDeepLink: (() => void) | null = null;
	let unlistenCrash: (() => void) | null = null;
	let unlistenExit: UnlistenFn | null = null;

	onMount(async () => {
		unlistenExit = await listen("core://exit-requested", async () => {
			try {
				const check = await invoke<ExitCheckResponse>("exit_check");
				if (check.can_exit) {
					await invoke("exit_app");
				} else {
					setBlockingTasks(check.blocking_tasks);
					setRunningInstances(check.running_instances);
					setExitDialogOpen(true);
				}
			} catch (e) {
				console.error("Failed to perform exit check:", e);
				// Fallback to exit if check fails? maybe safer to stay open or exit?
				// User explicitly asked for exit, so let's try to exit if check itself fails.
				await invoke("exit_app");
			}
		});

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
			// Initialize instance store from backend (non-blocking)
			setupInstanceListeners();
			initializeInstances().catch((error) => {
				console.error("Failed to initialize instance store:", error);
			});

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

			// Check DB status (diagnostics)
			if (hasTauriRuntime()) {
				invoke("get_db_status")
					.then((status: any) => {
						console.group("Database Diagnostic Report");
						console.log("Vesta DB Tables:", status.vesta?.tables || "NOT FOUND");
						console.log("Config DB Tables:", status.config?.tables || "NOT FOUND");
						console.groupEnd();
					})
					.catch((err) => {
						console.error("Failed to get DB status:", err);
					});
			}

			// Preload account heads (non-blocking)
			// This ensures skins are up to date on launch
			invoke("preload_account_heads").catch((error) => {
				console.error("Failed to preload account heads:", error);
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

			// Initialize file drop system
			initializeFileDropSystem().catch((error) => {
				console.error("Failed to initialize file drop system:", error);
			});
		}, 100); // 100ms delay to ensure UI renders first

		// Global window-level drag events to manage the sniffer
		const manager = getDropZoneManager();
		let leaveTimeout: any;

		const handleWindowDragEnter = (e: DragEvent) => {
			e.preventDefault();
			if (leaveTimeout) {
				clearTimeout(leaveTimeout);
				leaveTimeout = undefined;
			}
			
			// Detect if it's a file drag
			const isFileDrag = e.dataTransfer?.types.includes("Files");
			if (!isFileDrag) {
				// If they drag text or something else, we reset the sniffer session
				// so they can drag a file again later without having to fully leave the window
				if (manager.getSniffedPaths().length > 0 || manager.isDragging()) {
					console.log("[App] Non-file drag detected: resetting sniffer state");
					manager.clearSniffedPaths();
					manager.hideSniffer();
				}
				return;
			}

			// Add global dragging class for UI feedback
			document.body.classList.add("window--dragging");

			// Summon if we haven't sniffed yet AND the window isn't already active
			if (manager.getSniffedPaths().length === 0 && !manager.isSnifferVisible() && !manager.isDragging()) {
				manager.showSniffer();
			}
		};

		const handleWindowDragLeave = (e: DragEvent) => {
			e.preventDefault();
			// Only clear if we actually left the window (no relatedTarget)
			if (!e.relatedTarget) {
				if (leaveTimeout) clearTimeout(leaveTimeout);
				leaveTimeout = setTimeout(() => {
					console.log("[App] Final DragLeave: clearing state");
					document.body.classList.remove("window--dragging");
					manager.clearSniffedPaths();
					manager.hideSniffer();
					leaveTimeout = undefined;
				}, 300); // Increased timeout to handle focus swap jitter
			}
		};

		const handleWindowDrop = (e: DragEvent) => {
			if (leaveTimeout) {
				clearTimeout(leaveTimeout);
				leaveTimeout = undefined;
			}
			document.body.classList.remove("window--dragging");
			// Component handles the actual drop data, but we make sure state is reset
			// for next drag session if they dropped on a non-zone area
			manager.hideSniffer();
			setTimeout(() => {
				if (!manager.isDragging()) {
					manager.clearSniffedPaths();
				}
			}, 100);
		};

		const handleWindowDragOver = (e: DragEvent) => {
			e.preventDefault();

			if (leaveTimeout) {
				clearTimeout(leaveTimeout);
				leaveTimeout = undefined;
			}
			
			// Detect if it's a file drag
			const isFileDrag = e.dataTransfer?.types.includes("Files");
			if (!isFileDrag) {
				if (manager.getSniffedPaths().length > 0 || manager.isDragging()) {
					manager.clearSniffedPaths();
					manager.hideSniffer();
				}
				return;
			}

			if (!document.body.classList.contains("window--dragging")) {
				document.body.classList.add("window--dragging");
			}

			// Summon if we haven't sniffed yet AND the window isn't already active
			if (manager.getSniffedPaths().length === 0 && !manager.isSnifferVisible() && !manager.isDragging()) {
				manager.showSniffer();
			}
		};

		window.addEventListener("dragenter", handleWindowDragEnter);
		window.addEventListener("dragover", handleWindowDragOver);
		window.addEventListener("dragleave", handleWindowDragLeave);
		window.addEventListener("drop", handleWindowDrop);

		onCleanup(() => {
			window.removeEventListener("dragenter", handleWindowDragEnter);
			window.removeEventListener("dragover", handleWindowDragOver);
			window.removeEventListener("dragleave", handleWindowDragLeave);
			window.removeEventListener("drop", handleWindowDrop);
		});
	});

	onCleanup(() => {
		unlisten?.();
		unlistenDeepLink?.();
		unlistenCrash?.();
		unlistenExit?.();
		unsubscribeFromBackendNotifications();
		unsubscribeFromConfigUpdates();
		cleanupFileDropSystem();
	});

	// Hide loader on first paint rather than a fixed timeout
	requestAnimationFrame(() => {
		const loader = document.getElementById("app-loader");
		if (loader) {
			loader.classList.add("hidden");
			setTimeout(() => loader.remove(), 300);
		}
	});

	return (
		<>
			{props.children}
			<ConfirmExitDialog
				open={exitDialogOpen()}
				onOpenChange={setExitDialogOpen}
				blockingTasks={blockingTasks()}
				runningInstances={runningInstances()}
				onConfirm={() => invoke("exit_app")}
				onCancel={() => setExitDialogOpen(false)}
			/>
		</>
	);
}

export default App;
