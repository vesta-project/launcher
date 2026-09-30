import { dialogStore } from "@stores/dialog-store";
import {
	removeInstanceOptimistic,
	restoreInstanceOptimistic,
	setLaunching,
} from "@stores/instances";
import { showToast } from "@ui/toast/toast";
import {
	deleteInstance,
	duplicateInstance,
	getInstanceSlug,
	type Instance,
	launchInstance,
	repairInstance,
	resetInstance,
} from "@utils/instances";
import { t, tPlain } from "~/localization";

/**
 * Handles duplicating an instance with user prompt for name.
 */
export const handleDuplicate = async (instance: Instance) => {
	const newName = await dialogStore.prompt(
		t("action-duplicate-instance-prompt-title"),
		t("action-duplicate-instance-prompt-description"),
		{
			defaultValue: tPlain("action-duplicate-instance-default-name", {
				instanceName: instance.name,
			}),
		},
	);
	if (newName) {
		try {
			await duplicateInstance(instance.id, newName);
			showToast({
				title: t("action-duplicate-instance-toast-title"),
				description: t("action-duplicate-instance-toast-description", { newName }),
			});
		} catch (e) {
			console.error("Failed to duplicate instance:", e);
			showToast({
				title: t("action-duplicate-instance-failed-title"),
				description: String(e),
				severity: "error",
			});
		}
	}
};

/**
 * Handles repairing an instance with confirmation.
 */
export const handleRepair = async (instance: Instance) => {
	const confirmed = await dialogStore.confirm(
		t("action-repair-instance-confirm-title"),
		t("action-repair-instance-confirm-description", { instanceName: instance.name }),
		{ severity: "info" },
	);

	if (confirmed) {
		try {
			await repairInstance(instance.id);
			showToast({
				title: t("action-repair-started-title"),
				description: t("action-repair-started-description"),
			});
		} catch (e) {
			console.error("Repair failed:", e);
			showToast({
				title: t("action-repair-failed-title"),
				description: String(e),
				severity: "error",
			});
		}
	}
};

/**
 * Handles hard-resetting an instance with extreme warning.
 */
export const handleHardReset = async (instance: Instance) => {
	const confirmed = await dialogStore.confirm(
		t("action-hard-reset-confirm-title"),
		t("action-hard-reset-confirm-description", { instanceName: instance.name }),
		{ severity: "error", okLabel: t("action-hard-reset-confirm-ok"), isDestructive: true },
	);

	if (confirmed) {
		try {
			await resetInstance(instance.id);
			showToast({
				title: t("action-hard-reset-started-title"),
				description: t("action-hard-reset-started-description"),
			});
		} catch (e) {
			console.error("Hard reset failed:", e);
			showToast({
				title: t("action-reset-failed-title"),
				description: String(e),
				severity: "error",
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
	const confirmed = await dialogStore.confirm(
		t("action-uninstall-instance-confirm-title"),
		t("action-uninstall-instance-confirm-description", { instanceName: instance.name }),
		{ severity: "warning", okLabel: t("action-uninstall-instance-confirm-ok"), isDestructive: true },
	);

	if (confirmed) {
		const snapshot = removeInstanceOptimistic(instance.id);
		try {
			await deleteInstance(instance.id);
			showToast({
				title: t("action-uninstall-started-title"),
				description: t("action-uninstall-started-description", { instanceName: instance.name }),
			});
			if (onSuccess) onSuccess();
		} catch (e) {
			restoreInstanceOptimistic(snapshot);
			console.error("Uninstall failed:", e);
			showToast({
				title: t("action-uninstall-failed-title"),
				description: String(e),
				severity: "error",
			});
		}
	}
};

/**
 * Handles launching an instance.
 */
export const handleLaunch = async (instance: Instance) => {
	setLaunching(getInstanceSlug(instance), true);
	try {
		await launchInstance(instance);
		// Notification/Busy state is usually handled by the TaskManager and core events
	} catch (e) {
		console.error("Launch failed:", e);
		showToast({
			title: t("action-launch-failed-title"),
			description: String(e),
			severity: "error",
		});
	}
};
