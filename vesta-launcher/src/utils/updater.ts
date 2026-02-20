import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
	createNotification,
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
		if (pendingUpdate) {
			try {
				await showAlert(
					"info",
					"Installing Update",
					"Applying changes and restarting...",
					PROGRESS_INDETERMINATE,
					null,
					null,
					"app_update_install",
					"progress",
					false,
				);
				await pendingUpdate.install();
			} catch (error) {
				console.error("Failed to install update:", error);
				await showAlert(
					"error",
					"Update Error",
					"Failed to install the update. Please try again.",
					null,
					null,
					null,
					null,
					"immediate",
				);
			}
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
					isDownloading = false;
					isDownloaded = true;
					// Convert to Patient with Install action
					const actions = [
						{
							id: "install_app_update",
							label: "Install & Restart",
							type: "primary",
						},
					];

					createNotification({
						title: "Update Downloaded",
						description: `Vesta v${update.version} is ready to install. Restart to apply changes.`,
						notification_type: "patient",
						severity: "success",
						dismissible: false,
						actions: actions as any,
						client_key: "app_update",
					});
					break;
				}
			}
		});
	} catch (error) {
		isDownloading = false;
		console.error("Failed to download update:", error);
		await showAlert(
			"error",
			"Download Error",
			"Failed to download the update. Please try again.",
			null,
			null,
			null,
			"app_update_error",
			"immediate",
		);
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
				const actions = [
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
					actions: actions as any,
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
