import SessionExpiredDialog from "@components/auth/session-expired-dialog";
import { DialogRoot } from "@components/dialog/dialog-root";
import { openMiniPage, router } from "@components/page-viewer/page-viewer";
import { FatalPage } from "@components/pages/fatal/fatal-page";
import HomePage from "@components/pages/home/home";
import InitPage from "@components/pages/init/init";
import InvalidPage from "@components/pages/invalid";
import { Route, Router, useNavigate } from "@solidjs/router";
import { cleanupDialogSystem, dialogStore, initializeDialogSystem } from "@stores/dialog-store";
import "@stores/versions"; // eager-load version metadata on boot
import { setupInstanceListeners } from "@stores/instances";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { onOpenUrl, getCurrent } from "@tauri-apps/plugin-deep-link";
import { ChildrenProp } from "@ui/props";
import { showToast } from "@ui/toast/toast";
import {
	applyCommonConfigUpdates,
	onConfigUpdate,
	subscribeToConfigUpdates,
	unsubscribeFromConfigUpdates,
} from "@utils/config-sync";
import { subscribeToCrashEvents } from "@utils/crash-handler";
import { cleanupFileDropSystem, getDropZoneManager } from "@utils/file-drop";
import {
	handleDeepLink,
	handleQueuedIntents,
	type QueuedIntent,
} from "@utils/launch-intents";
import {
	cleanupNotifications,
	subscribeToBackendNotifications,
	unsubscribeFromBackendNotifications,
} from "@utils/notifications";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { checkForAppUpdates, initUpdateListener } from "@utils/updater";
import { GlobalModpackInstallDialog } from "@stores/modpack-install";
import { lazy, onCleanup, onMount } from "solid-js";

const StandalonePageViewer = lazy(() => import("@components/page-viewer/standalone-page-viewer"));

export interface ExitCheckResponse {
	can_exit: boolean;
	blocking_tasks: string[];
	running_instances: string[];
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
	let unlistenNavigate: UnlistenFn | null = null;

	let hasCheckedForUpdatesOnStartup = false;

	// Global window-level drag events to manage the sniffer
	const manager = getDropZoneManager();
	let leaveTimeout: any;

	// Hover clock removed: stopped tracking hovered elements and periodic logging

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
		// Read startup config for update checks only.
		// Initial theme application is handled by early bootstrap in index/theming.
		if (hasTauriRuntime()) {
			invoke<any>("get_config")
				.then((config) => {
					if (config?.startup_check_updates) {
						checkForAppUpdates(true);
					}
				})
				.catch((error) => console.error("Failed to read startup config:", error));
		}

		// Initialize update listener and set OS attribute on root for global CSS
		initUpdateListener();

		listen("core://check-for-updates", () => {
			if (!hasCheckedForUpdatesOnStartup) {
				hasCheckedForUpdatesOnStartup = true;
				checkForAppUpdates(true);
			}
		}).then((u) => {
			unlistenCheckUpdates = u;
		});

		listen("core://logout-guest", () => {
			window.location.href = "/";
		}).then((u) => {
			unlistenLogout = u;
		});

		listen("core://open-update-ui", () => {
			checkForAppUpdates();
		}).then((u) => {
			unlistenUpdate = u;
		});

		listen<{ path: string; params?: Record<string, unknown> }>("core://navigate", (event) => {
			console.log("[App] Received navigation event:", event.payload);
			if (router()) {
				openMiniPage(event.payload.path, event.payload.params);
			} else {
				showToast({
					title: "App Not Ready",
					description: "Please wait for the app to fully load before navigating.",
					severity: "error",
					duration: 5000,
				});
			}
		}).then((unlisten) => {
			unlistenNavigate = unlisten;
		});

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
				showToast({
					title: "Unable to confirm safe exit",
					description:
						"Vesta couldn't validate running tasks right now, so the launcher will stay open.",
					severity: "warning",
				});
			}
		}).then((u) => {
			unlistenExit = u;
		});

		// Setup deep-link handler for vesta:// URLs
		onOpenUrl((urls) => {
			console.log("Deep link received:", urls);

			if (urls && urls.length > 0) {
				void handleDeepLink(urls[0]);
			}
		})
			.then((u) => {
				unlistenDeepLink = u;
			})
			.catch((error) => {
				console.error("Failed to setup deep-link handler:", error);
			});

		const bootstrapLaunchIntents = async () => {
			if (!hasTauriRuntime()) {
				return;
			}

			listen<QueuedIntent[]>("core://handle-launch-intents", (event) => {
				console.log("[App] Received queued launch intents:", event.payload);
				void handleQueuedIntents(event.payload);
			}).catch((error) => {
				console.error("Failed to subscribe to launch intent handler:", error);
			});

			try {
				const currentUrls = await getCurrent();
				if (currentUrls?.length) {
					console.log("[App] Recovered cold-start deep links:", currentUrls);
					for (const url of currentUrls) {
						await handleDeepLink(url);
					}
				}
			} catch (error) {
				console.warn("Failed to read current deep links:", error);
			}

			try {
				const pending = await invoke<QueuedIntent[]>("consume_pending_intents");
				if (pending.length > 0) {
					console.log("[App] Consumed pending launch intents:", pending);
					await handleQueuedIntents(pending);
				}
			} catch (error) {
				console.warn("Failed to consume pending launch intents:", error);
			}

			try {
				await invoke("signal_frontend_ready");
			} catch (error) {
				console.warn("Failed to signal frontend ready:", error);
			}
		};

		void bootstrapLaunchIntents();

		// Defer non-critical initialization until the next frame.
		// This avoids fixed startup delays while still keeping first render responsive.
		requestAnimationFrame(() => {
			// Instance data bootstrapping is handled by startup bootstrap/home route.
			// This only wires background listeners and intentionally remains non-blocking.
			void setupInstanceListeners().catch((error) => {
				console.error("Failed to initialize instance listeners:", error);
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
						console.log("Vesta DB Tables:", status.vesta?.tables || "NOT FOUND");
						console.log("Config DB Tables:", status.config?.tables || "NOT FOUND");
						console.groupEnd();
					})
					.catch((err) => {
						console.error("Failed to get DB status:", err);
					});
			}

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

			// Check for updates on startup if already handled in onMount
			// (We moved the initial fetch to onMount for immediate theme application)

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
		});

		window.addEventListener("dragenter", handleWindowDragEnter);
		window.addEventListener("dragover", handleWindowDragOver);
		window.addEventListener("dragleave", handleWindowDragLeave);
		window.addEventListener("drop", handleWindowDrop);

		// (Hover clock logic intentionally removed)
	});

	onCleanup(() => {
		unlistenDeepLink?.();
		unlistenCrash?.();
		unlistenExit?.();
		unlistenLogout?.();
		unlistenUpdate?.();
		unlistenNavigate?.();
		unlistenCheckUpdates?.();
		cleanupDialogSystem();
		unsubscribeFromBackendNotifications();
		unsubscribeFromConfigUpdates();
		cleanupFileDropSystem();

		window.removeEventListener("dragenter", handleWindowDragEnter);
		window.removeEventListener("dragover", handleWindowDragOver);
		window.removeEventListener("dragleave", handleWindowDragLeave);
		window.removeEventListener("drop", handleWindowDrop);

		// (Hover clock cleanup removed)
	});

	return (
		<>
			{props.children}
			<SessionExpiredDialog />
			<DialogRoot />
			<GlobalModpackInstallDialog />
		</>
	);
}

export default App;
