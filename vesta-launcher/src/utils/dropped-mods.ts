import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@ui/toast/toast";
import type { RejectedDropItem } from "@utils/file-drop/drop-controller";
import type { Instance } from "@utils/instances";
import { isInstanceOperationInProgress } from "@utils/instances";

/** Only jars are accepted for now. Zips can be datapacks or modpacks and need their own handling. */
export const DROPPED_MOD_EXTENSIONS = [".jar"];

/** Disabled while the instance is installing: its mods folder is being written by the installer. */
export function canAcceptDroppedMods(instance: Instance): boolean {
	return !isInstanceOperationInProgress(instance);
}

/**
 * Starts the backend task that copies the jars into the instance's mods folder and
 * identifies them. Progress and the final status are shown by the task's own
 * notification, so this only reports a failure to start the task.
 */
export async function addDroppedMods(
	instance: Instance,
	paths: string[],
): Promise<void> {
	try {
		await invoke("add_dropped_mods", { instanceId: instance.id, paths });
	} catch (error) {
		showToast({
			title: "Couldn't add dropped mod",
			description: typeof error === "string" ? error : "Unexpected error.",
			severity: "error",
		});
	}
}

/** Explains why items were refused. Never includes paths. */
export function describeDroppedModRejection(
	items: RejectedDropItem[],
): string | null {
	if (items.length === 0) {
		return null;
	}
	if (items.some((item) => item.reason === "unreadable")) {
		return "Some dropped files could not be read.";
	}
	return "Only .jar mods can be dropped onto an instance for now.";
}

export function notifyDroppedModsRejected(items: RejectedDropItem[]): void {
	const description = describeDroppedModRejection(items);
	if (!description) {
		return;
	}
	showToast({
		title: "Not added",
		description,
		severity: "warning",
	});
}
