import { invoke } from "@tauri-apps/api/core";
import { Instance } from "./instances";

export interface ModpackInfo {
    name: string;
    version: string;
    author: string | null;
    description: string | null;
    iconUrl: string | null;
    minecraftVersion: string;
    modloader: string;
    modloaderVersion: string | null;
    modCount: number;
    recommendedRamMb?: number;
    format: string;
    modpackId?: string;
    modpackVersionId?: string;
    modpackPlatform?: string;
    fullMetadata?: any;
}

export interface ExportCandidate {
    path: string;
    isMod: boolean;
    size: number;
    platform?: string;
    projectId?: string;
    versionId?: string;
    hash?: string;
    downloadUrl?: string;
}

export async function getModpackInfo(path: string, targetId?: string, targetPlatform?: string): Promise<ModpackInfo> {
    return await invoke("get_modpack_info", { path, targetId, targetPlatform });
}

export async function getModpackInfoFromUrl(url: string, targetId?: string, targetPlatform?: string): Promise<ModpackInfo> {
    return await invoke("get_modpack_info_from_url", { url, targetId, targetPlatform });
}

export async function getHardwareInfo(): Promise<number> {
    return await invoke("get_hardware_info");
}

export async function getSystemMemoryMb(): Promise<number> {
    return await invoke("get_system_memory_mb");
}

export async function installModpackFromZip(zipPath: string, data: Partial<Instance>, metadata?: any): Promise<number> {
    const instanceData: Instance = {
        id: 0,
        name: data.name || "New Modpack",
        minecraftVersion: data.minecraftVersion || "1.20.1",
        modloader: (data.modloader === "vanilla" ? null : data.modloader) || null,
        modloaderVersion: data.modloaderVersion || null,
        javaPath: null,
        javaArgs: data.javaArgs || null,
        gameDirectory: null,
        width: data.width || 854,
        height: data.height || 480,
        minMemory: data.minMemory || 2048,
        maxMemory: data.maxMemory || 4096,
        iconPath: data.iconPath || null,
        lastPlayed: null,
        totalPlaytimeMinutes: 0,
        createdAt: null,
        updatedAt: null,
        installationStatus: "pending",
        modpackId: data.modpackId || null,
        modpackPlatform: data.modpackPlatform || null,
        modpackVersionId: data.modpackVersionId || null,
        modpackIconUrl: data.modpackIconUrl || null,
        iconData: null,
    };
    return await invoke("install_modpack_from_zip", { zipPath, instanceData, metadata: metadata || null });
}

export async function installModpackFromUrl(url: string, data: Partial<Instance>, metadata?: any): Promise<number> {
    const instanceData: Instance = {
        id: 0,
        name: data.name || "New Modpack",
        minecraftVersion: data.minecraftVersion || "1.20.1",
        modloader: (data.modloader === "vanilla" ? null : data.modloader) || null,
        modloaderVersion: data.modloaderVersion || null,
        javaPath: null,
        javaArgs: data.javaArgs || null,
        gameDirectory: null,
        width: data.width || 854,
        height: data.height || 480,
        minMemory: data.minMemory || 2048,
        maxMemory: data.maxMemory || 4096,
        iconPath: data.iconPath || null,
        lastPlayed: null,
        totalPlaytimeMinutes: 0,
        createdAt: null,
        updatedAt: null,
        installationStatus: "pending",
        modpackId: data.modpackId || null,
        modpackPlatform: data.modpackPlatform || null,
        modpackVersionId: data.modpackVersionId || null,
        modpackIconUrl: data.modpackIconUrl || null,
        iconData: null,
    };
    return await invoke("install_modpack_from_url", { url, instanceData, metadata: metadata || null });
}

export async function listExportCandidates(instanceId: number): Promise<ExportCandidate[]> {
    return await invoke("list_export_candidates", { instanceId });
}

export async function exportInstanceToModpack(
    instanceId: number, 
    outputPath: string, 
    format: string, 
    selections: ExportCandidate[],
    modpackName: string,
    version: string,
    author: string,
    description: string
): Promise<void> {
    return await invoke("export_instance_to_modpack", { 
        instanceId, 
        outputPath, 
        formatStr: format, 
        selections,
        modpackName,
        version,
        author,
        description
    });
}
