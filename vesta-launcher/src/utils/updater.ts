import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
	createNotification,
	type NotificationAction,
	PROGRESS_INDETERMINATE,
	showAlert,
	updateNotificationProgress,
} from "./notifications";

let pendingUpdate: Update | null = null;
let isListenerInitialized = false;
let isDownloading = false;
let isChecking = false;
let isDownloaded = false;

export function initUpdateListener() {
	if (isListenerInitialized) return;

	listen("core://install-app-update", async () => {
		console.log("[Updater] Received core://install-app-update event");
		if (pendingUpdate) {
			console.log(
				`[Updater] Found pending update: ${pendingUpdate.version} (isDownloaded: ${isDownloaded}, isDownloading: ${isDownloading})`,
			);

			// Check if already downloaded - Tauri plugin might lose state on hot-reload,
			// but if the UI is showing the "Install" button, we likely have the 'Finished' event cached.
			if (!isDownloaded) {
				console.warn(
					"[Updater] Update.install called but isDownloaded is false. Starting download...",
				);
				if (!isDownloading) {
					await downloadUpdate();
				}
				return;
			}

			try {
				console.log("[Updater] Calling pendingUpdate.install()...");

				// Re-use the existing notification to show installation progress
				await createNotification({
					title: "Installing Update",
					description: "Applying changes and restarting...",
					notification_type: "progress",
					severity: "info",
					progress: PROGRESS_INDETERMINATE,
					client_key: "app_update",
					dismissible: false,
				});

				// We call it without parameters as the artifacts are already downloaded.
				await pendingUpdate.install();
				console.log(
					"[Updater] pendingUpdate.install() call returned. Triggering backend restart...",
				);

				// TRIGGER BACKEND RESTART explicitly as fallback for some platforms/dev modes
				await invoke("invoke_notification_action", {
					actionId: "restart_app",
				});

				console.log("[Updater] Restart command invoked.");
			} catch (error) {
				console.error("[Updater] Failed to install update:", error);
				await showAlert(
					"error",
					"Update Error",
					`Failed to install the update: ${error}. Please try again manually.`,
					null,
					null,
					null,
					null,
					"immediate",
				);
			}
		} else {
			console.error(
				"[Updater] Received install event but pendingUpdate is null",
			);
			// If we don't have a pending update, check again
			checkForAppUpdates(false);
		}
	});

	listen("core://download-app-update", async () => {
		if (pendingUpdate) {
			await downloadUpdate();
		} else {
			checkForAppUpdates(false);
		}
	});

	isListenerInitialized = true;
}

export async function downloadUpdate() {
	if (isDownloaded || isDownloading || !pendingUpdate) return;
	isDownloading = true;

	const update = pendingUpdate;

	try {
		// Create a progress notification
		await createNotification({
			title: "Updating Vesta",
			description: `Downloading version ${update.version}...`,
			notification_type: "progress",
			severity: "info",
			progress: 0,
			client_key: "app_update",
			dismissible: false,
		});

		let downloaded = 0;
		let contentLength = 0;
		let lastReportedProgress = -5; // Start low to ensure first update

		await update.download((event) => {
			switch (event.event) {
				case "Started": {
					contentLength = event.data.contentLength || 0;
					break;
				}
				case "Progress": {
					downloaded += event.data.chunkLength;
					const progress =
						contentLength > 0
							? Math.round((downloaded / contentLength) * 100)
							: PROGRESS_INDETERMINATE;

					// Only update if progress has changed significantly to avoid IPC spam
					if (
						progress === PROGRESS_INDETERMINATE ||
						progress >= lastReportedProgress + 1 ||
						progress === 100
					) {
						lastReportedProgress = progress;
						updateNotificationProgress({
							client_key: "app_update",
							progress: progress,
						});
					}
					break;
				}
				case "Finished": {
					// The download is complete, but we wait for the outer promise to resolve
					// to ensure that post-download checks (e.g. signature verification)
					// have also completed successfully.
					console.log("[Updater] Download callback: Finished event received.");
					break;
				}
			}
		});

		isDownloading = false;
		isDownloaded = true;

		// Convert to Patient with Install action
		const actions: NotificationAction[] = [
			{
				id: "install_app_update",
				label: "Install & Restart",
				type: "primary",
			},
		];

		await createNotification({
			title: "Update Downloaded",
			description: `Vesta v${update.version} is ready to install. Restart to apply changes.`,
			notification_type: "patient",
			severity: "success",
			dismissible: false,
			actions: actions,
			client_key: "app_update",
		});
	} catch (error) {
		isDownloading = false;
		isDownloaded = false;
		console.error("Failed to download update:", error);

		let errorMessage = "Failed to download the update. Please try again.";
		let errorTitle = "Download Error";

		if (
			error &&
			typeof error === "string" &&
			(error.includes("Invalid encoding in minisign data") ||
				error.includes("signature"))
		) {
			errorTitle = "Update Verification Failed";
			errorMessage =
				"The update signature is missing or malformed for this platform. This is likely an issue with the release build.";
		} else if (
			error instanceof Error &&
			(error.message.includes("Invalid encoding in minisign data") ||
				error.message.includes("signature"))
		) {
			errorTitle = "Update Verification Failed";
			errorMessage =
				"The update signature is missing or malformed for this platform. This is likely an issue with the release build.";
		}

		await createNotification({
			title: errorTitle,
			description: errorMessage,
			notification_type: "patient",
			severity: "error",
			dismissible: true,
			client_key: "app_update",
		});
	}
}

export async function checkForAppUpdates(silent = false) {
	if (isChecking) return;
	isChecking = true;
	initUpdateListener();
	try {
		const update = await check();

		if (update) {
			isDownloaded = false;
			pendingUpdate = update;

			const config = await invoke<any>("get_config");
			const autoUpdate = config.auto_update_enabled ?? true;

			if (autoUpdate) {
				if (!silent) {
					await showAlert(
						"info",
						"Update Available",
						`Version ${update.version} is available. Downloading now...`,
						null,
						null,
						null,
						null,
						"immediate",
					);
				}
				downloadUpdate();
			} else {
				const actions: NotificationAction[] = [
					{
						id: "download_app_update",
						label: "Download",
						type: "primary",
					},
				];

				await createNotification({
					title: "Update Available",
					description: `Vesta Launcher v${update.version} is now available!`,
					notification_type: "patient",
					severity: "info",
					dismissible: false,
					actions: actions,
					client_key: "app_update",
				});

				if (!silent) {
					await showAlert(
						"info",
						"Update Available",
						`Version ${update.version} is available.`,
						null,
						null,
						null,
						null,
						"immediate",
					);
				}
			}
		} else if (!silent) {
			await showAlert(
				"success",
				"No Updates",
				"You are running the latest version of Vesta.",
				null,
				null,
				null,
				null,
				"immediate",
			);
		}
	} catch (error) {
		console.error("Failed to check for updates:", error);
		if (!silent) {
			await showAlert(
				"error",
				"Update Error",
				"Could not check for updates. Please try again later.",
				null,
				null,
				null,
				null,
				"immediate",
			);
		}
	} finally {
		isChecking = false;
	}
}

export async function simulateUpdateProcess() {
	try {
		const simulatedVersion = "9.9.9-debug";
		showAlert(
			"info",
			"Update Available (Simulated)",
			`Version ${simulatedVersion} is available. Downloading now...`,
		);

		// Create a progress notification
		await createNotification({
			title: "Updating Vesta (Simulated)",
			description: `Downloading version ${simulatedVersion}...`,
			notification_type: "progress",
			severity: "info",
			progress: 0,
			client_key: "app_update",
		});

		// Simulated progress
		for (let i = 0; i <= 100; i += 10) {
			await new Promise((r) => setTimeout(r, 400));
			await invoke("update_notification_progress", {
				payload: {
					client_key: "app_update",
					progress: i,
				},
			});
		}

		// Convert to Patient with Install action
		const actions = [
			{
				id: "install_app_update",
				label: "Install & Restart",
				type: "primary",
			},
		];

		await invoke("create_notification", {
			payload: {
				title: "Update Ready (Simulated)",
				description: `Vesta has been updated to v${simulatedVersion}. Please restart to apply changes.`,
				notification_type: "patient",
				severity: "success",
				dismissible: true,
				actions: JSON.stringify(actions),
				client_key: "app_update",
			},
		});
	} catch (error) {
		console.error("Failed to simulate update:", error);
	}
}
