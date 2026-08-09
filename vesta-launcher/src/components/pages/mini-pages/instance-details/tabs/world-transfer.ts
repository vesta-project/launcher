import type { Instance } from "@stores/instances";
import type { WorldSummary } from "@stores/worlds";

const normalizedLoader = (instance: Instance) =>
	(instance.modloader ?? "").trim().toLowerCase();

export function isPureVanillaInstance(instance: Instance): boolean {
	const loader = normalizedLoader(instance);
	return !instance.modpackId && (loader === "" || loader === "vanilla");
}

export function getWorldTransferWarnings(
	world: Pick<WorldSummary, "gameVersion">,
	source: Instance,
	destination: Instance,
): string[] {
	const warnings: string[] = [];
	if (source.minecraftVersion !== destination.minecraftVersion) {
		warnings.push(
			`Instance versions differ (${source.minecraftVersion} → ${destination.minecraftVersion}).`,
		);
	}
	if (
		source.modpackId !== destination.modpackId ||
		source.modpackVersionId !== destination.modpackVersionId
	) {
		warnings.push("The instances use different modpacks or modpack versions.");
	}
	if (!isPureVanillaInstance(source) || !isPureVanillaInstance(destination)) {
		warnings.push("At least one instance is modded or linked to a modpack.");
	}
	if (world.gameVersion && world.gameVersion !== destination.minecraftVersion) {
		warnings.push(
			`The world was last saved in ${world.gameVersion}; the destination uses ${destination.minecraftVersion}.`,
		);
	}
	return [...new Set(warnings)];
}
