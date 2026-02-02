import { check } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@ui/toast/toast";

export async function checkForAppUpdates(silent = false) {
	try {
		const update = await check();
		
		if (update) {
			if (!silent) {
				showToast({
					title: "Update Available",
					description: `Version ${update.version} is available. Downloading now...`,
					severity: "Info"
				});
			}

			// Create a progress notification
			const notificationId = await invoke<number>("create_notification", {
				input: {
					title: "Updating Vesta",
					description: `Downloading version ${update.version}...`,
					notification_type: "Progress",
					severity: "info",
					progress: 0,
					client_key: "app_update"
				}
			});

			let downloaded = 0;
			let contentLength = 0;

			await update.downloadAndInstall((event) => {
				switch (event.event) {
					case 'Started': {
						contentLength = event.data.contentLength || 0;
						break;
					}
					case 'Progress': {
						downloaded += event.data.chunkLength;
						const progress = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : -1;
						invoke("update_notification_progress", {
							id: notificationId,
							progress: progress
						});
						break;
					}
					case 'Finished': {
						// Convert to Patient with Restart action
						const actions = [
							{
								action_id: "restart_app",
								label: "Restart now",
								action_type: "primary"
							}
						];

						invoke("create_notification", {
							input: {
								id: notificationId, // Upsert/Replace
								title: "Update Ready",
								description: `Vesta has been updated to v${update.version}. Please restart to apply changes.`,
								notification_type: "Patient",
								severity: "success",
								dismissible: true,
								actions: JSON.stringify(actions)
							}
						});
						break;
					}
				}
			});
		} else if (!silent) {
			showToast({
				title: "No Updates",
				description: "You are running the latest version of Vesta.",
				severity: "Info"
			});
		}
	} catch (error) {
		console.error("Failed to check for updates:", error);
		if (!silent) {
			showToast({
				title: "Update Error",
				description: "Could not check for updates. Please try again later.",
				severity: "Error"
			});
		}
	}
}
