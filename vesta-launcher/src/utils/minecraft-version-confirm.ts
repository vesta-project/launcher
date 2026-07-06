import { dialogStore } from "@stores/dialog-store";

export type MinecraftVersionChangeContext = "manual" | "modpack-update";

export interface MinecraftVersionChangeParams {
	instanceName: string;
	currentVersion: string;
	nextVersion: string;
	context: MinecraftVersionChangeContext;
}

function buildDescription(params: MinecraftVersionChangeParams): string {
	const action =
		params.context === "modpack-update"
			? "Updating this modpack will change the Minecraft version"
			: "Changing the Minecraft version";

	return [
		`${action} for "${params.instanceName}" from ${params.currentVersion} to ${params.nextVersion}.`,
		"",
		"Existing worlds may become incompatible or unusable after this change.",
		"",
		"Are you sure you want to continue?",
	].join("\n");
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
		"Change Minecraft Version?",
		buildDescription(params),
		{
			severity: "warning",
			okLabel: "Change Version",
			isDestructive: true,
		},
	);
}
