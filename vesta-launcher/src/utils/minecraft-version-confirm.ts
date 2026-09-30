import { dialogStore } from "@stores/dialog-store";
import { t } from "~/localization";

export type MinecraftVersionChangeContext = "manual" | "modpack-update";

export interface MinecraftVersionChangeParams {
	instanceName: string;
	currentVersion: string;
	nextVersion: string;
	context: MinecraftVersionChangeContext;
}

function buildDescription(params: MinecraftVersionChangeParams): string {
	return t("action-minecraft-version-confirm-description", {
		instanceName: params.instanceName,
		currentVersion: params.currentVersion,
		nextVersion: params.nextVersion,
		action: t(params.context === "modpack-update"
			? "action-minecraft-version-update-warning"
			: "action-minecraft-version-change-warning", {
				instanceName: params.instanceName,
				currentVersion: params.currentVersion,
				nextVersion: params.nextVersion,
			}),
		worldWarning: t("action-minecraft-version-world-warning"),
		question: t("action-minecraft-version-continue-question"),
	});
}

/**
 * Prompts the user before changing an instance's Minecraft version.
 * Returns true immediately when the version is unchanged.
 */
export async function confirmMinecraftVersionChange(
	params: MinecraftVersionChangeParams,
): Promise<boolean> {
	if (params.currentVersion === params.nextVersion) {
		return true;
	}

	return await dialogStore.confirm(
		t("action-minecraft-version-confirm-title"),
		buildDescription(params),
		{
			severity: "warning",
			okLabel: t("action-minecraft-version-confirm-ok"),
			isDestructive: true,
		},
	);
}
