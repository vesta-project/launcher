import { invoke } from "@tauri-apps/api/core";

export type LauncherKind =
	| "curseforgeFlame"
	| "gdlauncher"
	| "prism"
	| "multimc"
	| "modrinthApp"
	| "atlauncher"
	| "ftb"
	| "technic";

export interface DetectedLauncher {
	kind: LauncherKind;
	displayName: string;
	detectedPaths: string[];
}

export interface ExternalInstanceCandidate {
	id: string;
	name: string;
	instancePath: string;
	gameDirectory: string;
	iconPath?: string | null;
	minecraftVersion?: string | null;
	modloader?: string | null;
	modloaderVersion?: string | null;
	modpackPlatform?: string | null;
	modpackId?: string | null;
	modpackVersionId?: string | null;
	lastPlayedAtUnixMs?: number | null;
	modsCount?: number | null;
	resourcepacksCount?: number | null;
	shaderpacksCount?: number | null;
	worldsCount?: number | null;
	screenshotsCount?: number | null;
	gameDirectorySizeBytes?: number | null;
}

export interface ImportExternalInstanceRequest {
	launcher: LauncherKind;
	instancePath: string;
	selectedInstance?: ExternalInstanceCandidate | null;
	basePathOverride?: string | null;
	instanceNameOverride?: string | null;
}

export async function detectExternalLaunchers(): Promise<DetectedLauncher[]> {
	return await invoke("detect_external_launchers");
}

export async function listExternalInstances(
	launcher: LauncherKind,
	basePathOverride?: string,
): Promise<ExternalInstanceCandidate[]> {
	return await invoke("list_external_instances", {
		launcher,
		basePathOverride: basePathOverride ?? null,
	});
}

export async function importExternalInstance(
	request: ImportExternalInstanceRequest,
): Promise<{ instanceId: number }> {
	return await invoke("import_external_instance", { request });
}

