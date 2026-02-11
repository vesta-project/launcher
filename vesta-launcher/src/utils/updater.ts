import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { showToast } from "@ui/toast/toast";
import { PROGRESS_INDETERMINATE } from "./notifications";

let pendingUpdate: Update | null = null;
let isListenerInitialized = false;
let isDownloading = false;
let isChecking = false;
let isDownloaded = false;

export function initUpdateListener() {
	if (isListenerInitialized) return;

	listen("core://update-available", (event) => {
		console.log("Update available (from backend):", event.payload);
	});

	listen("core://install-app-update", async () => {
		if (pendingUpdate) {
			try {
				showToast({
					title: "Installing Update",
					description: "Applying changes and restarting...",
					severity: "Info",
				});
				await pendingUpdate.install();
			} catch (error) {
				console.error("Failed to install update:", error);
				showToast({
					title: "Update Error",
					description: "Failed to install the update. Please try again.",
					severity: "Error",
				});
			}
		}
	});

	listen("core://download-app-update", async () => {
		if (pendingUpdate) {
			await downloadUpdate();
		} else {
			// If we don't have a pending update object, check for one first
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
		await invoke<number>("create_notification", {
			payload: {
				title: "Updating Vesta",
				description: `Downloading version ${update.version}...`,
				notification_type: "progress",
				severity: "info",
				progress: 0,
				client_key: "app_update",
			},
		});

		let downloaded = 0;
		let contentLength = 0;

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
					invoke("update_notification_progress", {
						payload: {
							client_key: "app_update",
							progress: progress,
						},
					});
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

					invoke("create_notification", {
						payload: {
							title: "Update Downloaded",
							description: `Vesta v${update.version} is ready to install. Restart to apply changes.`,
							notification_type: "patient",
							severity: "success",
							dismissible: true,
							actions: JSON.stringify(actions),
							client_key: "app_update",
						},
					});
					break;
				}
			}
		});
	} catch (error) {
		isDownloading = false;
		console.error("Failed to download update:", error);
		showToast({
			title: "Download Error",
			description: "Failed to download the update. Please try again.",
			severity: "Error",
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

			// Get config to see if we should auto-download
			const config = await invoke<any>("get_config");
			const autoUpdate = config.auto_update_enabled ?? true;

			if (autoUpdate) {
				if (!silent) {
					showToast({
						title: "Update Available",
						description: `Version ${update.version} is available. Downloading now...`,
						severity: "Info",
					});
				}
				downloadUpdate();
			} else {
				// Show "Update Available" notification with "Download" button
				const actions = [
					{
						id: "download_update",
						label: "Download",
						type: "primary",
					},
				];

				await invoke("create_notification", {
					payload: {
						title: "Update Available",
						description: `Vesta Launcher v${update.version} is now available!`,
						notification_type: "patient",
						severity: "info",
						dismissible: true,
						actions: JSON.stringify(actions),
						client_key: "app_update",
					},
				});

				if (!silent) {
					showToast({
						title: "Update Available",
						description: `Version ${update.version} is available.`,
						severity: "Info",
					});
				}
			}
		} else if (!silent) {
			showToast({
				title: "No Updates",
				description: "You are running the latest version of Vesta.",
				severity: "Info",
			});
		}
	} catch (error) {
		console.error("Failed to check for updates:", error);
		if (!silent) {
			showToast({
				title: "Update Error",
				description: "Could not check for updates. Please try again later.",
				severity: "Error",
			});
		}
	} finally {
		isChecking = false;
	}
}

export async function simulateUpdateProcess() {
	try {
		const simulatedVersion = "9.9.9-debug";
		showToast({
			title: "Update Available (Simulated)",
			description: `Version ${simulatedVersion} is available. Downloading now...`,
			severity: "Info",
		});

		// Create a progress notification
		await invoke("create_notification", {
			payload: {
				title: "Updating Vesta (Simulated)",
				description: `Downloading version ${simulatedVersion}...`,
				notification_type: "progress",
				severity: "info",
				progress: 0,
				client_key: "app_update",
			},
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
