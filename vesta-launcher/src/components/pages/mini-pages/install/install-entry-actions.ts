import type { ResourceType } from "@stores/resources";
import { open } from "@tauri-apps/plugin-dialog";
import type { LauncherKind } from "@utils/launcher-imports";

export type InstallNavigate = (
	path: string,
	params?: Record<string, unknown>,
) => void;

export const EXPLORE_RESOURCE_TYPES = [
	{ value: "mod" as const, label: "Mods" },
	{ value: "resourcepack" as const, label: "Resource Packs" },
	{ value: "shader" as const, label: "Shaders" },
	{ value: "datapack" as const, label: "Data Packs" },
	{ value: "modpack" as const, label: "Modpacks" },
	{ value: "world" as const, label: "Worlds" },
] satisfies ReadonlyArray<{ value: ResourceType; label: string }>;

/** Client-side gate before navigating to URL install. Backend still validates the pack. */
export function isHttpUrl(value: string): boolean {
	const trimmed = value.trim();
	return /^https?:\/\//i.test(trimmed);
}

export async function pickLocalModpackFile(): Promise<string | null> {
	const selected = await open({
		multiple: false,
		filters: [{ name: "Modpack", extensions: ["zip", "mrpack"] }],
	});
	if (selected && typeof selected === "string") return selected;
	return null;
}

export function openBlankInstall(navigate: InstallNavigate): void {
	navigate("/install");
}

export function openLocalModpackInstall(
	navigate: InstallNavigate,
	modpackPath: string,
): void {
	navigate("/install", { modpackPath, isModpack: true });
}

export function openUrlModpackInstall(
	navigate: InstallNavigate,
	modpackUrl: string,
): void {
	navigate("/install", { modpackUrl: modpackUrl.trim(), isModpack: true });
}

export async function openBrowseModpacks(
	navigate: InstallNavigate,
): Promise<void> {
	const { resources } = await import("@stores/resources");
	resources.setType("modpack");
	navigate("/resources", { resourceType: "modpack" });
}

export function openLauncherImport(
	navigate: InstallNavigate,
	kind?: LauncherKind,
): void {
	if (kind) navigate("/install/import", { launcher: kind });
	else navigate("/install/import");
}

export async function openExploreResourceType(
	navigate: InstallNavigate,
	resourceType: ResourceType,
): Promise<void> {
	const { resources } = await import("@stores/resources");
	resources.setType(resourceType);
	navigate("/resources", { resourceType });
}

export async function pickAndOpenLocalModpack(
	navigate: InstallNavigate,
): Promise<boolean> {
	const path = await pickLocalModpackFile();
	if (!path) return false;
	openLocalModpackInstall(navigate, path);
	return true;
}
