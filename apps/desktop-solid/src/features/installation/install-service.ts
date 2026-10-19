import { loadVersions } from "../browse/browse-projects";
import { hasDownloadableArtifact, isSourceId } from "../browse/browse-model";
import { onlinePackInfo, type OnlinePackSelection } from "./online-pack";
import type { PackSourceMatch } from "./pack-metadata";
import { invoke } from "@tauri-apps/api/core";
import { newNativeInstance, type NativeInstance } from "../instances/native-model";
import { refreshNativeInstances } from "../instances/native-service";

export interface PackInfo {
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
  fullMetadata?: unknown;
  downloadCount?: number | null;
}
export const matchLocalPack = (path: string) =>
  invoke<PackSourceMatch>("match_local_modpack_source", { path });
export interface PackRelease {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  download_url: string;
}
export type PackSource = { kind: "file" | "url"; value: string; online?: OnlinePackSelection };
export interface InstallDraft {
  name: string;
  icon: string;
  minecraft: string;
  loader: string;
  loaderVersion: string;
  memory: number[];
}
export const readPack = (source: PackSource): Promise<PackInfo> =>
  source.online ? Promise.resolve(onlinePackInfo(source.online)) : invoke<PackInfo>(
    source.kind === "file" ? "get_modpack_info" : "get_modpack_info_from_url",
    source.kind === "file" ? { path: source.value } : { url: source.value },
  );
/** Share Browse's version cache and in-flight reads instead of repeating the same IPC. */
export const packReleases = (info: PackInfo): Promise<PackRelease[]> =>
  info.modpackId && info.modpackPlatform && isSourceId(info.modpackPlatform)
    ? loadVersions(info.modpackPlatform, info.modpackId).then((versions) => versions.map((version) => ({
        ...version,
        download_url: hasDownloadableArtifact(version) ? version.download_url || version.files?.[0]?.url || "" : "",
      })))
    : Promise.resolve([]);

export async function installationDefaults() {
  return invoke<{ default_min_memory: number; default_max_memory: number }>("get_config");
}
export function installationRecord(draft: InstallDraft, pack?: PackInfo): NativeInstance {
  // Imported manifests may resolve the precise loader version inside the existing installer.
  if (
    draft.memory.length !== 2 ||
    !draft.memory.every(Number.isFinite) ||
    draft.memory[0] < 512 ||
    draft.memory[1] < draft.memory[0]
  )
    throw new Error("Invalid memory allocation");
  if (!pack && draft.loader !== "vanilla" && !draft.loaderVersion)
    throw new Error("Choose a compatible loader version");
  const record = newNativeInstance(draft.name, draft.minecraft);
  return {
    ...record,
    iconPath: draft.icon,
    minMemory: draft.memory[0],
    maxMemory: draft.memory[1],
    modloader: draft.loader === "vanilla" ? null : draft.loader,
    modloaderVersion: draft.loader === "vanilla" ? null : draft.loaderVersion || null,
    modpackId: pack?.modpackId || null,
    modpackVersionId: pack?.modpackVersionId || null,
    modpackPlatform: pack?.modpackPlatform || null,
    modpackIconUrl: pack?.iconUrl || null,
  };
}
export class InstallationStartError extends Error {
  constructor(
    readonly instanceId: number,
    reason: unknown,
  ) {
    super(String(reason));
  }
}
/** Original flow: create → read the persisted record → queue install → return to Library. */
export async function startInstallation(
  draft: InstallDraft,
  source?: PackSource,
  pack?: PackInfo,
): Promise<number> {
  const instanceData = installationRecord(draft, pack);
  if (source) {
    const id = await invoke<number>(
      source.kind === "file" ? "install_modpack_from_zip" : "install_modpack_from_url",
      {
        ...(source.kind === "file" ? { zipPath: source.value } : { url: source.value }),
        instanceData,
        metadata: pack?.fullMetadata ?? null,
      },
    );
    await refreshNativeInstances(true);
    return id;
  }
  const id = await invoke<number>("create_instance", { instanceData });
  try {
    const fresh = await invoke<NativeInstance>("get_instance", { instanceId: id });
    await invoke("install_instance", { instanceData: fresh });
  } catch (reason) {
    // Keep the created instance recoverable; retrying must not create a duplicate.
    throw new InstallationStartError(id, reason);
  } finally {
    await refreshNativeInstances(true);
  }
  return id;
}
