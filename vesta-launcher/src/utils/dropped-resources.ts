import { waitForManualDropChoices } from "@stores/manual-resource-drops";
import { waitForWorldArchiveChoices } from "@stores/worlds";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@ui/toast/toast";
import type { RejectedDropItem } from "@utils/file-drop/drop-controller";
import { type Instance, isInstanceOperationInProgress } from "@utils/instances";
import { t } from "~/localization";

export const DROPPED_RESOURCE_EXTENSIONS = [".jar", ".zip"];

export function canAcceptDroppedResources(instance: Instance): boolean {
	return (
		!isInstanceOperationInProgress(instance) &&
		!["pending", "verifying-runtime", "launch-preflight-repair"].includes(
			instance.installationStatus ?? "",
		)
	);
}

/** The backend owns inspection, decisions, installation and progress notices. */
export async function addDroppedResources(
	instance: Instance,
	paths: string[],
): Promise<void> {
	try {
		await Promise.all([
			waitForManualDropChoices(),
			waitForWorldArchiveChoices(),
		]);
		await invoke("start_resource_drop", { instanceId: instance.id, paths });
	} catch (error) {
		showToast({
			title: t("resource-drop-start-failed"),
			description:
				typeof error === "string"
					? error
					: error instanceof Error
						? error.message
						: t("resource-drop-unexpected-error"),
			severity: "error",
		});
	}
}

export function describeDroppedResourceRejection(
	items: RejectedDropItem[],
): string | null {
	if (items.length === 0) return null;
	if (items.some((item) => item.reason === "unreadable"))
		return t("resource-drop-unreadable");
	return t("resource-drop-supported-files");
}

export function notifyDroppedResourcesRejected(
	items: RejectedDropItem[],
): void {
	const description = describeDroppedResourceRejection(items);
	if (!description) return;
	showToast({
		title: t("resource-drop-not-added"),
		description,
		severity: "warning",
	});
}
