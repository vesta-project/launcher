import { check } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@ui/toast/toast";
import { PROGRESS_INDETERMINATE } from "./notifications";

export async function checkForAppUpdates(silent = false) {
	try {
		const update = await check();

		if (update) {
			if (!silent) {
				showToast({
					title: "Update Available",
					description: `Version ${update.version} is available. Downloading now...`,
					severity: "Info",
				});
			}

			// Create a progress notification
			const notificationId = await invoke<number>("create_notification", {
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

			await update.downloadAndInstall((event) => {
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
						// Convert to Patient with Restart action
						const actions = [
							{
								id: "restart_app",
								label: "Restart now",
								type: "primary",
							},
						];

						invoke("create_notification", {
							payload: {
								title: "Update Ready",
								description: `Vesta has been updated to v${update.version}. Please restart to apply changes.`,
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

		// Convert to Patient with Restart action
		const actions = [
			{
				id: "restart_app",
				label: "Restart now",
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
