import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createSignal, onSettled } from "solid-js";
import { nativeInstances, nativeRecord, displayImage, performNative, reportInstanceError, changeNativeEngine } from "./native-service";
import type { NativeVersion, NativeResource } from './native-details-model';
import { minecraftVersionIds, loaderVersions } from "./metadata";
import { unlinkBundledResources } from "./details";
import { editInstance, findInstance, retryInstance } from "./catalog";

export interface EngineVersion {
  minecraft: string;
  loader: string;
  loaderVersion: string;
}
export interface PackRelease extends EngineVersion {
  id: string;
  label: string;
  experimental?: boolean;
  channel: ReleaseChannel;
  publishedAt?: string;
  changes: string;
}
export type ReleaseChannel = "release" | "beta" | "alpha";
export type PackSource = "Modrinth" | "CurseForge";
export interface LinkedPack {
  icon: string;
  name: string;
  source: PackSource;
  /** Project id on the source platform, used to fetch changelogs. */
  projectId?: string;
  installed: string;
  installedLabel?: string;
  releases: PackRelease[];
}
const previewMinecraftVersions = [
  "1.21.4",
  "1.21.1",
  "1.20.1",
  "1.19.4",
  "1.12.2",
  "1.8.9",
  "24w44a",
  "1.21.4-rc1",
];
export const minecraftVersions = () => nativeInstances ? minecraftVersionIds() : previewMinecraftVersions;
export const experimentalVersion = (version: string) =>
  /\d+w\d+|-(pre|rc)/i.test(version);
export function compatibleLoaderVersions(
  minecraft: string,
  loader: string,
): string[] {
  if (nativeInstances) return loaderVersions(minecraft, loader);
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
  if (nativeInstances) return undefined;
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
        channel: "release",
        publishedAt: "2026-09-02",
        changes: "4 updated resources, 1 added resource",
      },
      { ...engine, id: "1.2.0", label: "1.2.0", channel: "release", publishedAt: "2026-07-18", changes: "Installed release" },
      {
        ...engine,
        id: "1.1.0",
        label: "1.1.0",
        channel: "release",
        publishedAt: "2026-05-30",
        changes: "Earlier release; review before downgrading",
      },
      {
        ...engine,
        id: "1.4.0-beta",
        label: "1.4.0 beta",
        experimental: true,
        channel: "beta",
        publishedAt: "2026-10-01",
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
          nativeInstances ? nativeRecord(id)?.modloaderVersion ?? "" : compatibleLoaderVersions(
            instance.minecraftVersion, instance.modloader,
          )[0] ?? "",
      },
      pack: initialPack(id),
    },
    { name: `versions:${id}` },
  );
  const currentState = () => {
    if (!nativeInstances) return state();
    const record = nativeRecord(id);
    return { engine: record ? {
      minecraft: record.minecraftVersion, loader: record.modloader || 'vanilla',
      loaderVersion: record.modloaderVersion || '',
    } : state().engine, pack: record?.modpackId ? state().pack ?? nativePack(id) : undefined };
  };
  return { state: currentState, setState };
}
export function versionStore(id: string) {
  let store = stores.get(id);
  if (!store) {
    store = createVersionStore(id);
    stores.set(id, store);
  }
  return store;
}
export async function applyEngineVersion(
  id: string,
  engine: EngineVersion,
  packRelease?: string,
) {
  if (nativeInstances) {
    if (packRelease) { await performNative(id, (record) => invoke('start_modpack_update', { instanceId: record.id, newVersionId: packRelease })); return; }
    const saved = await changeNativeEngine(id, engine.minecraft, engine.loader, engine.loaderVersion);
    if (saved) versionStore(id).setState((state)=>({ ...state, engine }));
    return;
  }
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
  if (nativeInstances) return performNative(id, async (record) => {
    let bundled: NativeResource[] = [];
    if (removeBundled) {
      await invoke('backfill_modpack_resource_provenance', { instanceId: record.id });
      bundled = (await invoke<NativeResource[]>('get_installed_resources', { instanceId: record.id }))
        .filter((row) => row.source_kind === 'modpack');
    }
    // Explicit unlink releases ownership before its optional cleanup. Ordinary
    // Resources deletion must never remove files while the pack owns them.
    await invoke('update_instance', { instanceData: { ...record, modpackId: null, modpackVersionId: null, modpackPlatform: null, modpackIconUrl: null } });
    await invoke('clear_modpack_resource_provenance', { instanceId: record.id });
    for (const row of bundled) {
      await invoke('delete_resource', { instanceId: record.id, resourceId: row.id });
    }
  });
  versionStore(id).setState((state) => ({ ...state, pack: undefined }));
  unlinkBundledResources(id, removeBundled);
}

function nativePack(id: string, versions: NativeVersion[] = [], name?: string): LinkedPack | undefined {
  const record = nativeRecord(id);
  if (!record?.modpackId?.trim()) return undefined;
  const engine = { minecraft: record.minecraftVersion, loader: record.modloader || 'vanilla', loaderVersion: record.modloaderVersion || '' };
  const releases: PackRelease[] = releaseOrder(versions).map((version) => ({ ...engine, minecraft: version.game_versions[0] ?? engine.minecraft,
    loader: version.loaders.find((loader) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) ?? engine.loader,
    id: version.id, label: version.version_number, experimental: version.release_type !== 'release',
    channel: channelOf(version.release_type), publishedAt: typeof version.published_at === 'string' ? version.published_at.slice(0, 10) : undefined, changes: '' }));
  const installed = record.modpackVersionId ?? '';
  if (!releases.some((release) => release.id === installed)) releases.push({ ...engine, id: installed, label: installed, experimental: false, channel: 'release', changes: '' });
  return { name: name || record.name, icon: displayImage(record), projectId: record.modpackId ?? undefined, source: record.modpackPlatform === 'curseforge' ? 'CurseForge' : 'Modrinth',
    installed, installedLabel: releases.find((release) => release.id === installed)?.label, releases };
}
export function useNativePack(id: string) {
  if (!nativeInstances) return;
  onSettled(() => {
    let disposed = false, revision = 0;
    const refresh = async () => {
      const record = nativeRecord(id);
      const projectId = record?.modpackId?.trim();
      const platform = record?.modpackPlatform;
      if (!projectId || !platform || !['modrinth', 'curseforge'].includes(platform)) return;
      const current = ++revision;
      try {
        const [versions, project] = await Promise.allSettled([
          invoke<NativeVersion[]>('get_resource_versions', { platform, projectId, ignoreCache: false }),
          invoke<{name:string}>('get_resource_project', { platform, id: projectId }),
        ]);
        if (disposed || current !== revision || nativeRecord(id)?.modpackId !== record.modpackId
          || nativeRecord(id)?.modpackPlatform !== platform || nativeRecord(id)?.modpackVersionId !== record.modpackVersionId) return;
        // Project enrichment is optional: a failed name lookup must not discard releases.
        versionStore(id).setState((state) => ({ ...state, pack: versions.status === 'rejected' && state.pack
          ? { ...state.pack, name: project.status === 'fulfilled' ? project.value.name : state.pack.name }
          : nativePack(id,
          versions.status === 'fulfilled' ? versions.value : [],
          project.status === 'fulfilled' ? project.value.name : undefined) }));
        if (versions.status === 'rejected') reportInstanceError(versions.reason);
      } catch (reason) { if (!disposed) reportInstanceError(reason); }
    };
    let stop: (() => void) | undefined;
    void listen<{id:number}>('core://instance-updated', ({payload}) => { if (String(payload.id) === id) void refresh(); }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch(reportInstanceError);
    void refresh();
    return () => { disposed = true; stop?.(); };
  });
}

const channelOf = (value: string): ReleaseChannel => value === 'beta' || value === 'alpha' ? value : 'release';
const releaseOrder = (versions: NativeVersion[]) => [...versions].sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')));

/* ---- Changelog and update preview ---- */
export interface UpdatePreview {
  /** Provider changelog text, when the platform supplies one. */
  changelog?: string;
  /**
   * Resource-level diff. The native update engine does not expose a dry run, so
   * these stay undefined outside the browser fixtures and the dialog says so.
   */
  added?: string[];
  removed?: string[];
  updated?: string[];
}
const changelogCache = new Map<string, Promise<string | undefined>>();
const fixtureChangelogs: Record<string, string> = {
  "1.4.0-beta": "Experimental build.\n- Reworked world generation tweaks\n- Known issue: shaders may flicker",
  "1.3.0": "- Updated Sodium, Lithium and Iris\n- Added Mod Menu\n- Fixed a crash when opening the pause menu",
  "1.2.0": "- Balance changes to early-game recipes\n- Updated 3 mods",
  "1.1.0": "- Initial stable release of this pack line",
};
function plainText(raw: string, format: string): string {
  if (format !== 'html') return raw.trim();
  return raw.replace(/<br\s*\/?>|<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}
export function releaseChangelog(source: PackSource, projectId: string | undefined, releaseId: string): Promise<string | undefined> {
  if (nativeInstances && !projectId?.trim()) return Promise.resolve(undefined);
  const key = `${source}:${projectId}:${releaseId}`;
  let cached = changelogCache.get(key);
  if (!cached) {
    cached = nativeInstances
      ? invoke<{ changelog: string | null; changelog_format: string }>('get_resource_version_details', { platform: source.toLowerCase(), projectId, versionId: releaseId })
          .then((details) => details.changelog ? plainText(details.changelog, details.changelog_format) || undefined : undefined)
      : Promise.resolve(fixtureChangelogs[releaseId]);
    cached.catch(() => changelogCache.delete(key));
    changelogCache.set(key, cached);
  }
  return cached;
}
export async function previewPackUpdate(pack: LinkedPack, release: PackRelease): Promise<UpdatePreview> {
  const changelog = await releaseChangelog(pack.source, pack.projectId, release.id).catch(() => undefined);
  if (nativeInstances) return { changelog };
  const downgrade = pack.releases.findIndex((item) => item.id === release.id) > pack.releases.findIndex((item) => item.id === pack.installed);
  return downgrade
    ? { changelog, added: ["Create Deco (0.4)"], removed: ["Mod Menu", "Iris Shaders"], updated: ["Sodium 0.6.1 to 0.5.8"] }
    : { changelog, added: ["Mod Menu"], removed: [], updated: ["Sodium 0.5.8 to 0.6.1", "Lithium 0.14 to 0.15", "Iris 1.7 to 1.8", "Create 6.0.1 to 6.0.3"] };
}

/* ---- Linking an unlinked instance ---- */
export interface PackCandidate { id: string; source: PackSource; name: string; summary: string; icon: string; author: string }
const fixturePacks: PackCandidate[] = [
  { id: "create-pack", source: "Modrinth", name: "Create: Above and Beyond", summary: "Industrial automation expert pack", icon: "", author: "Fixture" },
  { id: "atm10", source: "CurseForge", name: "All the Mods 10", summary: "Kitchen sink modpack", icon: "", author: "Fixture" },
  { id: "fabulously-optimized", source: "Modrinth", name: "Fabulously Optimized", summary: "Performance and visuals", icon: "", author: "Fixture" },
];
/** Accepts a Modrinth or CurseForge project URL and returns the platform plus slug/id. */
export function parsePackUrl(input: string): { source: PackSource; id: string } | undefined {
  const text = input.trim();
  const modrinth = /modrinth\.com\/(?:modpack|project)\/([^/?#\s]+)/i.exec(text);
  if (modrinth) return { source: "Modrinth", id: modrinth[1] };
  const curse = /curseforge\.com\/minecraft\/modpacks\/([^/?#\s]+)/i.exec(text);
  return curse ? { source: "CurseForge", id: curse[1] } : undefined;
}
interface NativeProject { id: string; name: string; summary: string; icon_url: string | null; author: string }
const candidate = (source: PackSource, project: NativeProject): PackCandidate =>
  ({ id: project.id, source, name: project.name, summary: project.summary, icon: project.icon_url ?? "", author: project.author });
export async function searchPacks(source: PackSource, query: string): Promise<PackCandidate[]> {
  if (!nativeInstances) {
    const text = query.trim().toLowerCase();
    return fixturePacks.filter((pack) => pack.source === source && pack.name.toLowerCase().includes(text));
  }
  const parsed = parsePackUrl(query);
  if (parsed) {
    if (parsed.source === "CurseForge") {
      // Slugs cannot be fetched directly on CurseForge, so search by the slug text.
      const response = await invoke<{ hits: NativeProject[] }>('search_resources', { platform: 'curseforge', query: searchQuery(parsed.id.replace(/-/g, ' ')) });
      return response.hits.map((project) => candidate("CurseForge", project));
    }
    const project = await invoke<NativeProject>('get_resource_project', { platform: 'modrinth', id: parsed.id });
    return [candidate("Modrinth", project)];
  }
  const response = await invoke<{ hits: NativeProject[] }>('search_resources', { platform: source.toLowerCase(), query: searchQuery(query.trim()) });
  return response.hits.map((project) => candidate(source, project));
}
const searchQuery = (text: string) => ({ text: text || null, resource_type: 'modpack', offset: 0, limit: 12, game_version: null, loader: null,
  client: false, server: false, creator: null, categories: null, sort_by: null, sort_order: null });
export async function packReleases(pack: PackCandidate): Promise<PackRelease[]> {
  if (!nativeInstances) {
    const engine = { minecraft: "1.20.1", loader: "fabric", loaderVersion: "0.16.10" };
    return [
      { ...engine, id: "2.0.0", label: "2.0.0", channel: "release", publishedAt: "2026-09-10", changes: "" },
      { ...engine, id: "2.1.0-beta", label: "2.1.0 beta", channel: "beta", experimental: true, publishedAt: "2026-10-02", changes: "" },
    ];
  }
  const versions = await invoke<NativeVersion[]>('get_resource_versions', { platform: pack.source.toLowerCase(), projectId: pack.id, ignoreCache: false });
  return releaseOrder(versions).map((version) => ({ minecraft: version.game_versions[0] ?? "", loader: version.loaders.find((loader) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) ?? 'vanilla',
    loaderVersion: "", id: version.id, label: version.version_number, channel: channelOf(version.release_type), experimental: version.release_type !== 'release',
    publishedAt: typeof version.published_at === 'string' ? version.published_at.slice(0, 10) : undefined, changes: "" }));
}
/**
 * Links an existing instance to a pack release. This only records the source
 * (the same fields a launcher import sets); the update engine bootstraps its
 * manifest from the linked release on the next update, and no files are changed.
 */
export function linkPack(id: string, pack: PackCandidate, release: PackRelease) {
  if (nativeInstances) return performNative(id, async (record) => {
    await invoke('update_instance', { instanceData: { ...record, modpackId: pack.id, modpackVersionId: release.id,
      modpackPlatform: pack.source.toLowerCase(), modpackIconUrl: pack.icon || null } });
  });
  versionStore(id).setState((state) => ({ ...state, pack: { name: pack.name, icon: findInstance(id)!.instance.image, source: pack.source,
    projectId: pack.id, installed: release.id, installedLabel: release.label, releases: [release] } }));
  return Promise.resolve(true);
}
