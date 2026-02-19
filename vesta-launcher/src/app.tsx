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
import { checkForAppUpdates, initUpdateListener } from "@utils/updater";
import {
	cleanupNotifications,
	subscribeToBackendNotifications,
	unsubscribeFromBackendNotifications,
} from "@utils/notifications";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { getOsType, ensureOsType } from "@utils/os";
import { createSignal, lazy, onCleanup, onMount } from "solid-js";
import { initializeInstances, setupInstanceListeners } from "@stores/instances";
import SessionExpiredDialog from "@components/auth/session-expired-dialog";
import { DialogRoot } from "@components/dialog/dialog-root";
import { cleanupDialogSystem, initializeDialogSystem, dialogStore } from "@stores/dialog-store";
import { showToast } from "@ui/toast/toast";
import { getActiveAccount, ACCOUNT_TYPE_GUEST } from "@utils/auth";
import { setPageViewerOpen, router } from "@components/page-viewer/page-viewer";

const StandalonePageViewer = lazy(
	() => import("@components/page-viewer/standalone-page-viewer"),
);

export interface ExitCheckResponse {
	can_exit: boolean;
	blocking_tasks: string[];
	running_instances: string[];
}

/**
 * Handles deep-link URLs like vesta://install?projectId=X&platform=Y
 * Parses the URL via Rust backend and navigates if initialized and authenticated
 */
export async function handleDeepLink(
	url: string,
	navigate: ReturnType<typeof useNavigate>,
) {
	try {
		if (hasTauriRuntime()) {
			try {
				await invoke("show_window_from_tray");
			} catch (e) {
				console.warn("Failed to show window for deep link:", e);
			}
		} 
		// 1. Check if app is initialized
		const config = await invoke<any>("get_config");
		if (!config || !config.setup_completed) {
			showToast({
				title: "Setup Required",
				description:
					"Please complete the onboarding process before using 'Open in Vesta'.",
				severity: "Error",
				duration: 5000,
			});
			return;
		}

		// 2. Check if authenticated
		const account = await getActiveAccount();
		if (
			!account ||
			account.account_type === ACCOUNT_TYPE_GUEST ||
			account.is_expired
		) {
			showToast({
				title: "Authentication Required",
				description:
					"Please sign in to a valid account to use 'Open in Vesta'.",
				severity: "Error",
				duration: 5000,
			});
			return;
		}

		// 3. Parse URL via backend
		const metadata = await invoke<{
			target: string;
			params: Record<string, string>;
		}>("parse_vesta_url", { url });

		console.log("Deep link parsed via Rust:", metadata);

		// Map targets to mini-router paths
		let path = "";
		switch (metadata.target) {
			case "install":
				path = "/install";
				break;
			case "resource-details":
				path = "/resource-details";
				break;
			case "home":
				// Just focus the app, which is done by the single-instance plugin
				// and this handler means we're already here.
				return;
			default:
				console.warn("Unknown deep link target:", metadata.target);
				path = "/config"; // Fallback
		}

		// Always use the integrated PageViewer in the main window
		const mini_router = router();
		if (mini_router) {
			mini_router.navigate(path, metadata.params);
			setPageViewerOpen(true);
		} else {
			// If router isn't ready, show error - no standalone fallback
			showToast({
				title: "App Not Ready",
				description: "Please wait for the app to fully load before using 'Open in Vesta'.",
				severity: "Error",
				duration: 5000,
			});
		}
	} catch (error) {
		console.error("Failed to parse deep link:", url, error);
		showToast({
			title: "Invalid Link",
			description: "The Vesta link you clicked is invalid or unsupported.",
			severity: "Error",
			duration: 5000,
		});
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

	let unlistenDeepLink: (() => void) | null = null;
	let unlistenCrash: (() => void) | null = null;
	let unlistenExit: UnlistenFn | null = null;
	let unlistenLogout: UnlistenFn | null = null;
	let unlistenUpdate: UnlistenFn | null = null;
	let unlistenCheckUpdates: UnlistenFn | null = null;

	let hasCheckedForUpdatesOnStartup = false;

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
		if (
			manager.getSniffedPaths().length === 0 &&
			!manager.isSnifferVisible() &&
			!manager.isDragging()
		) {
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
		if (
			manager.getSniffedPaths().length === 0 &&
			!manager.isSnifferVisible() &&
			!manager.isDragging()
		) {
			manager.showSniffer();
		}
	};

	onMount(() => {
		// Initialize update listener and set OS attribute on root for global CSS
		initUpdateListener();

		// Set initial OS on document root so global CSS can target it
		const initialOs = getOsType();
		if (initialOs) {
			document.documentElement.setAttribute("data-os", initialOs);
		} else {
			ensureOsType().then((os) => {
				if (os) document.documentElement.setAttribute("data-os", os);
			});
		}
		listen("core://check-for-updates", () => {
			if (!hasCheckedForUpdatesOnStartup) {
				hasCheckedForUpdatesOnStartup = true;
				checkForAppUpdates(true);
			}
		}).then((u) => { unlistenCheckUpdates = u; });

		listen("core://logout-guest", () => {
			window.location.href = "/";
		}).then((u) => { unlistenLogout = u; });

		listen("core://open-update-ui", () => {
			checkForAppUpdates();
		}).then((u) => { unlistenUpdate = u; });

		listen("core://exit-requested", async () => {
			try {
				const check = await invoke<ExitCheckResponse>("exit_check");
				if (check.can_exit) {
					await invoke("exit_app");
				} else {
					const confirmed = await dialogStore.confirm(
						"Active Processes Detected",
						`The launcher is still performing some actions or games are running:\n\n${[
							...check.running_instances.map((i) => `• ${i}`),
							...check.blocking_tasks.map((t) => `• ${t}`),
						].join("\n")}\n\nClosing now may cause issues.`,
						{
							okLabel: "Exit Anyway",
							cancelLabel: "Stay Open",
							isDestructive: true,
							severity: "warning",
						},
					);
					if (confirmed) {
						await invoke("exit_app");
					}
				}
			} catch (e) {
				console.error("Failed to perform exit check:", e);
				// Fallback to exit if check fails? maybe safer to stay open or exit?
				// User explicitly asked for exit, so let's try to exit if check itself fails.
				await invoke("exit_app");
			}
		}).then((u) => { unlistenExit = u; });

		// Setup deep-link handler for vesta:// URLs
		onOpenUrl((urls) => {
			console.log("Deep link received:", urls);

			// Handle the first URL in the array
			if (urls && urls.length > 0) {
				const url = urls[0];
				void handleDeepLink(url, navigate);
			}
		})
			.then((u) => { unlistenDeepLink = u; })
			.catch((error) => {
				console.error("Failed to setup deep-link handler:", error);
			});

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

			// Setup unified dialog system
			initializeDialogSystem()
				.then(() => {
					console.log("Dialog system initialized");
				})
				.catch((error) => {
					console.error("Failed to initialize dialog system:", error);
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
						console.log(
							"Vesta DB Tables:",
							status.vesta?.tables || "NOT FOUND",
						);
						console.log(
							"Config DB Tables:",
							status.config?.tables || "NOT FOUND",
						);
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

			// Handle CLI Arguments & Deep Links
			const handleCLI = async (args: string[]) => {			if (hasTauriRuntime()) {
				try {
					await invoke("show_window_from_tray");
				} catch (e) {
					console.warn("Failed to show window for CLI args:", e);
				}
			}				console.log("[App] Received CLI args:", args);
				for (let i = 0; i < args.length; i++) {
					const arg = args[i];
					if (arg.startsWith("vesta://")) {
						await handleDeepLink(arg, navigate);
						continue;
					}

					if (arg === "--launch-instance" && args[i + 1]) {
						const slug = args[i + 1];
						const { instancesState, setLaunching, initializeInstances } = await import("@stores/instances");
						await initializeInstances();
						const inst = instancesState.instances.find(inst => (inst as any).slug === slug || inst.name.toLowerCase().replace(/ /g, "-") === slug);
						if (inst) {
							setLaunching(slug, true);
							await invoke("launch_instance", { instanceData: inst });
						}
						i++;
					} else if (arg === "--open-instance" && args[i + 1]) {
						const slug = args[i + 1];
						const { setPageViewerOpen, router } = await import("@components/page-viewer/page-viewer");
						router()?.navigate("/instance", { slug });
						setPageViewerOpen(true);
						i++;
					} else if (arg === "--open-resource" && args[i + 2]) {
						const platform = args[i + 1];
						const id = args[i + 2];
						const { setPageViewerOpen, router } = await import("@components/page-viewer/page-viewer");
						router()?.navigate("/resource-details", { platform, projectId: id });
						setPageViewerOpen(true);
						i += 2;
					}
				}
			};

			listen<string[]>("core://handle-cli", (event) => {
				handleCLI(event.payload);
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

			// Check for updates on startup if enabled
			if (hasTauriRuntime()) {
				invoke<any>("get_config")
					.then((config) => {
						if (config.startup_check_updates) {
							checkForAppUpdates(true);
						}
					})
					.catch((error) =>
						console.error("Failed to check for updates on startup:", error),
					);
			}

			// Setup config sync system (non-blocking)
			subscribeToConfigUpdates()
				.then(() => {
					onConfigUpdate(applyCommonConfigUpdates);
				})
				.catch((error) => {
					console.error("Failed to initialize config sync:", error);
				});

			// Initialize file drop system
			// Temporarily disabled
			// initializeFileDropSystem().catch((error) => {
			// 	console.error("Failed to initialize file drop system:", error);
			// });
		}, 100); // 100ms delay to ensure UI renders first

		window.addEventListener("dragenter", handleWindowDragEnter);
		window.addEventListener("dragover", handleWindowDragOver);
		window.addEventListener("dragleave", handleWindowDragLeave);
		window.addEventListener("drop", handleWindowDrop);
	});

	onCleanup(() => {
		unlistenDeepLink?.();
		unlistenCrash?.();
		unlistenExit?.();
		unlistenLogout?.();
		unlistenUpdate?.();
		unlistenCheckUpdates?.();
		cleanupDialogSystem();
		unsubscribeFromBackendNotifications();
		unsubscribeFromConfigUpdates();
		cleanupFileDropSystem();

		window.removeEventListener("dragenter", handleWindowDragEnter);
		window.removeEventListener("dragover", handleWindowDragOver);
		window.removeEventListener("dragleave", handleWindowDragLeave);
		window.removeEventListener("drop", handleWindowDrop);
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
			<SessionExpiredDialog />
			<DialogRoot />
		</>
	);
}

export default App;
