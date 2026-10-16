import { createSignal } from "solid-js";
import { unlinkBundledResources } from "./details";
import { editInstance, findInstance, retryInstance } from "./fixtures";

export interface EngineVersion {
  minecraft: string;
  loader: string;
  loaderVersion: string;
}
export interface PackRelease extends EngineVersion {
  id: string;
  label: string;
  experimental?: boolean;
  changes: string;
}
export interface LinkedPack {
  icon: string;
  name: string;
  source: "Modrinth" | "CurseForge";
  installed: string;
  releases: PackRelease[];
}
export const minecraftVersions = [
  "1.21.4",
  "1.21.1",
  "1.20.1",
  "1.19.4",
  "1.12.2",
  "1.8.9",
  "24w44a",
  "1.21.4-rc1",
];
export const experimentalVersion = (version: string) =>
  /\d+w\d+|-(pre|rc)/i.test(version);
export function compatibleLoaderVersions(
  minecraft: string,
  loader: string,
): string[] {
  if (loader === "vanilla") return [];
  if (loader === "fabric" && /^(1\.(19|20|21)|24w)/.test(minecraft))
    return ["0.16.10", "0.16.9"];
  if (loader === "quilt" && /^1\.(19|20|21)/.test(minecraft))
    return ["0.28.0", "0.27.1"];
  if (loader === "neoforge" && minecraft.startsWith("1.21"))
    return minecraft.startsWith("1.21.4")
      ? ["21.4.137", "21.4.129"]
      : ["21.1.133", "21.1.122"];
  if (loader === "forge")
    return minecraft === "1.20.1"
      ? ["47.4.0", "47.3.0"]
      : minecraft === "1.12.2"
        ? ["14.23.5.2860"]
        : minecraft === "1.8.9"
          ? ["11.15.1.2318"]
          : [];
  return [];
}
function initialPack(id: string): LinkedPack | undefined {
  if (!["create", "atm"].includes(id)) return undefined;
  const entry = findInstance(id)!.instance;
  const engine = {
    minecraft: entry.minecraftVersion,
    loader: entry.modloader,
    loaderVersion:
      compatibleLoaderVersions(entry.minecraftVersion, entry.modloader)[0] ??
      "",
  };
  return {
    name: entry.name,
    icon: entry.image,
    source: id === "atm" ? "CurseForge" : "Modrinth",
    installed: "1.2.0",
    releases: [
      {
        ...engine,
        id: "1.3.0",
        label: "1.3.0",
        changes: "4 updated resources, 1 added resource",
      },
      { ...engine, id: "1.2.0", label: "1.2.0", changes: "Installed release" },
      {
        ...engine,
        id: "1.1.0",
        label: "1.1.0",
        changes: "Earlier release; review before downgrading",
      },
      {
        ...engine,
        id: "1.4.0-beta",
        label: "1.4.0 beta",
        experimental: true,
        changes: "Experimental release; back up worlds first",
      },
    ],
  };
}
const stores = new Map<string, ReturnType<typeof createVersionStore>>();
function createVersionStore(id: string) {
  const instance = findInstance(id)!.instance;
  const [state, setState] = createSignal(
    {
      engine: {
        minecraft: instance.minecraftVersion,
        loader: instance.modloader,
        loaderVersion:
          compatibleLoaderVersions(
            instance.minecraftVersion,
            instance.modloader,
          )[0] ?? "",
      },
      pack: initialPack(id),
    },
    { name: `versions:${id}` },
  );
  return { state, setState };
}
export function versionStore(id: string) {
  let store = stores.get(id);
  if (!store) {
    store = createVersionStore(id);
    stores.set(id, store);
  }
  return store;
}
export function applyEngineVersion(
  id: string,
  engine: EngineVersion,
  packRelease?: string,
) {
  const store = versionStore(id);
  store.setState((state) => ({
    engine,
    pack: state.pack
      ? { ...state.pack, installed: packRelease ?? state.pack.installed }
      : undefined,
  }));
  editInstance(id, {
    minecraftVersion: engine.minecraft,
    modloader: engine.loader,
  });
  retryInstance(id, "Updating");
}
export function unlinkPack(id: string, removeBundled: boolean) {
  versionStore(id).setState((state) => ({ ...state, pack: undefined }));
  unlinkBundledResources(id, removeBundled);
}
