import { ask, confirm } from "@tauri-apps/plugin-dialog";
import { showToast } from "@ui/toast/toast";
import {
	Instance,
	duplicateInstance,
	repairInstance,
	resetInstance,
	deleteInstance,
	launchInstance,
} from "@utils/instances";

/**
 * Handles duplicating an instance with user prompt for name.
 */
export const handleDuplicate = async (instance: Instance) => {
	const newName = window.prompt(
		"Enter name for the copy:",
		`${instance.name} (Copy)`,
	);
	if (newName) {
		try {
			await duplicateInstance(instance.id, newName);
			showToast({
				title: "Duplicating instance",
				description: `Creating copy as "${newName}"...`,
			});
		} catch (e) {
			console.error("Failed to duplicate instance:", e);
			showToast({
				title: "Duplicate failed",
				description: String(e),
				severity: "Error",
			});
		}
	}
};

/**
 * Handles repairing an instance with confirmation.
 */
export const handleRepair = async (instance: Instance) => {
	const confirmed = await confirm(
		`Are you sure you want to repair "${instance.name}"? This will re-verify all game files and modloader versions.`,
		{
			title: "Repair Instance",
			kind: "info",
		},
	);

	if (confirmed) {
		try {
			await repairInstance(instance.id);
			showToast({
				title: "Repair started",
				description: "Verifying game integrity...",
			});
		} catch (e) {
			console.error("Repair failed:", e);
			showToast({
				title: "Repair failed",
				description: String(e),
				severity: "Error",
			});
		}
	}
};

/**
 * Handles hard-resetting an instance with extreme warning.
 */
export const handleHardReset = async (instance: Instance) => {
	const confirmed = await ask(
		`This will wipe the ENTIRE instance folder for "${instance.name}".\n\nAll worlds, screenshots, and custom mods will be DELETED! This action cannot be undone.\n\nAre you absolutely sure?`,
		{
			title: "Vesta Launcher - Hard Reset",
			kind: "error",
		},
	);

	if (confirmed) {
		try {
			await resetInstance(instance.id);
			showToast({
				title: "Hard reset started",
				description: "Wiping instance data and resetting to default...",
			});
		} catch (e) {
			console.error("Hard reset failed:", e);
			showToast({
				title: "Reset failed",
				description: String(e),
				severity: "Error",
			});
		}
	}
};

/**
 * Handles uninstalling/deleting an instance.
 */
export const handleUninstall = async (
	instance: Instance,
	onSuccess?: () => void,
) => {
	const confirmed = await ask(
		`Are you sure you want to uninstall "${instance.name}"?\n\nThis will permanently delete the instance and its files.`,
		{
			title: "Uninstall Instance",
			kind: "warning",
		},
	);

	if (confirmed) {
		try {
			await deleteInstance(instance.id);
			showToast({
				title: "Uninstalling",
				description: `"${instance.name}" is being removed...`,
			});
			if (onSuccess) onSuccess();
		} catch (e) {
			console.error("Uninstall failed:", e);
			showToast({
				title: "Uninstall failed",
				description: String(e),
				severity: "Error",
			});
		}
	}
};

/**
 * Handles launching an instance.
 */
export const handleLaunch = async (instance: Instance) => {
	try {
		await launchInstance(instance);
		// Notification/Busy state is usually handled by the TaskManager and core events
	} catch (e) {
		console.error("Launch failed:", e);
		showToast({
			title: "Launch failed",
			description: String(e),
			severity: "Error",
		});
	}
};
