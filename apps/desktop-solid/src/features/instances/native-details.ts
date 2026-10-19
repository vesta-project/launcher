import { t } from '../../localization';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createSignal, onSettled, untrack } from 'solid-js';
import { CacheInvalidatedError, RequestCache } from '../../platform/cache/request-cache';
import type { InstalledResource, Screenshot, WorldInfo } from './details';
import { nativeInstances, nativeRecord, displayImage, performNative, reportInstanceError } from './native-service';
import { instanceSlug } from './native-model';
import { resourceFromNative, resourceScope, resourceSource, worldFromNative, type NativeResource, type NativeVersion, type NativeWorld, type NativeDatapack } from './native-details-model';

interface DetailState {
  resources: InstalledResource[]; worlds: WorldInfo[]; screenshots: Screenshot[];
  rows: NativeResource[]; updates: Record<string, NativeVersion>;
}
const [data, setData] = createSignal<Record<string, DetailState>>({}, { name: 'nativeInstanceDetails' });
const empty = (): DetailState => ({ resources: [], worlds: [], screenshots: [], rows: [], updates: {} });
export const nativeDetails = (id: string) => data()[id] ?? empty();
// Separate data and update checks so rows appear before slower network work completes.
// RequestCache shares in-flight IPC and retires invalidated responses. No polling or disk mirror.
const policy = { maxEntries: 24, staleTimeMs: 30_000, retentionMs: 300_000 };
interface ResourceSnapshot { rows: NativeResource[]; resources: InstalledResource[] }
const resourceCache = new RequestCache<ResourceSnapshot>(policy);
const updateCache = new RequestCache<{ versionKey: string; updates: Record<string, NativeVersion> }>({ ...policy, staleTimeMs: 60_000 });
const versionKeys = new WeakMap<ResourceSnapshot, string>();
const checkedVersions = new WeakSet<ResourceSnapshot>();
// Bulk mutations own their final refresh; their per-file host events must not trigger scans.
const resourceMutations = new Set<string>();
const worldCache = new RequestCache<WorldInfo[]>(policy);
const screenshotCache = new RequestCache<Screenshot[]>(policy);
export const nativeDetailCacheMetrics = {
  resources: resourceCache.metrics, updates: updateCache.metrics,
  worlds: worldCache.metrics, screenshots: screenshotCache.metrics,
};
const patch = (id: string, values: Partial<DetailState>) => setData((all) => {
  if (Object.entries(values).every(([key, value]) => all[id]?.[key as keyof DetailState] === value)) return all;
  return Object.fromEntries([
    ...Object.entries(all).filter(([key]) => key !== id).slice(-11), [id, { ...(all[id] ?? empty()), ...values }],
  ]);
});
function iconFor(id: string) { const record = nativeRecord(resourceScope(id).instanceId); return record ? displayImage(record) : ''; }
function invalidateResources(scope: string) {
  resourceCache.invalidate(scope);
  updateCache.invalidate(scope);
}
function withUpdates(resources: InstalledResource[], updates: Record<string, NativeVersion>) {
  return resources.map((row) => row.update === updates[row.id]?.version_number
    ? row : { ...row, update: updates[row.id]?.version_number });
}
async function resourceSnapshot(scope: string): Promise<ResourceSnapshot> {
  const { instanceId, world } = resourceScope(scope);
  const fallbackIcon = iconFor(scope);
  if (world) {
    const overview = await invoke<{ entries: NativeDatapack[] }>('list_world_datapacks', { worldRef: world });
    return {
      resources: overview.entries.map((row) => ({
        id: row.resourceId === null ? `file:${row.fileName}` : String(row.resourceId), kind: 'datapack',
        project: row.projectId && row.platform && ['modrinth', 'curseforge', 'smithed'].includes(row.platform)
          ? { source: row.platform as NonNullable<InstalledResource['project']>['source'], id: row.projectId } : undefined,
        filename: row.fileName, name: row.displayName, author: '', version: row.versionNumber ?? '',
        enabled: row.enabled, sizeKb: Math.ceil(row.sizeBytes / 1024), source: resourceSource(row.platform),
        icon: fallbackIcon, readOnly: row.readOnly || row.resourceId === null,
      })),
      rows: overview.entries.filter((row) => row.resourceId !== null).map((row) => ({
        id: row.resourceId!, platform: row.platform ?? '', remote_id: row.projectId ?? '', remote_version_id: row.versionId ?? '',
        resource_type: 'datapack', local_path: row.fileName, display_name: row.displayName,
        current_version: row.versionNumber ?? '', is_manual: !row.managed, is_enabled: row.enabled,
        file_size: row.sizeBytes, source_kind: '',
      })),
    };
  }
  const overview = await invoke<{ resources: NativeResource[]; projectRecords: { id: string; source: string; icon_url?: string }[] }>('get_instance_resource_overview', { instanceId: Number(instanceId) });
  const icons = new Map(overview.projectRecords.map((project) => [JSON.stringify([project.source, project.id]), project.icon_url]));
  return { rows: overview.resources, resources: overview.resources.map((row) =>
    resourceFromNative(row, icons.get(JSON.stringify([row.platform, row.remote_id])) || fallbackIcon)) };
}
async function resourceUpdates(scope: string, force: boolean) {
  const { instanceId, world } = resourceScope(scope);
  if (world) {
    const checked = await invoke<{ updates: { resourceId: number; exactVersion: NativeVersion | null }[] }>('check_world_datapack_updates', { worldRef: world, forceRefresh: force });
    return Object.fromEntries(checked.updates.filter((row) => row.exactVersion).map((row) => [String(row.resourceId), row.exactVersion!]));
  }
  const checked = await invoke<{ resourceUpdates: { resourceId: number; version: NativeVersion }[] }>('check_instance_updates_lightweight', { instanceId: Number(instanceId), forceRefresh: force });
  return Object.fromEntries(checked.resourceUpdates.map((row) => [String(row.resourceId), row.version]));
}
export async function loadNativeResources(scope: string, force = false) {
  if (force) invalidateResources(scope);
  try {
    const snapshot = await resourceCache.read(scope, () => resourceSnapshot(scope));
    if (resourceCache.peek(scope)?.data !== snapshot) return;
    const previous = nativeDetails(scope);
    if (previous.rows !== snapshot.rows) {
      // A known update is only retained while the installed file/version still matches.
      const oldRows = new Map(previous.rows.map((row) => [row.id, row]));
      const retained = Object.fromEntries(snapshot.rows.flatMap((row) => {
        const old = oldRows.get(row.id);
        return old?.remote_version_id === row.remote_version_id && old?.current_version === row.current_version
          && old?.platform === row.platform && old?.remote_id === row.remote_id && previous.updates[row.id]
          ? [[String(row.id), previous.updates[row.id]]] : [];
      }));
      patch(scope, { rows: snapshot.rows, resources: withUpdates(snapshot.resources, retained), updates: retained });
    }
    let versionKey = versionKeys.get(snapshot);
    if (versionKey === undefined) {
      versionKey = JSON.stringify(snapshot.rows.map((row) => [row.id, row.platform, row.remote_id, row.remote_version_id, row.current_version]));
      versionKeys.set(snapshot, versionKey);
    }
    if (!checkedVersions.has(snapshot)) {
      checkedVersions.add(snapshot);
      // Also retire an older in-flight check with no cached result yet. Only the
      // first reader of this snapshot invalidates; concurrent readers share its replacement.
      updateCache.invalidate(scope);
    }
    const result = await updateCache.read(scope, async () => ({ versionKey, updates: await resourceUpdates(scope, force) }));
    const updates = result.updates;
    if (resourceCache.peek(scope)?.data !== snapshot || updateCache.peek(scope)?.data !== result || result.versionKey !== versionKey) return;
    const current = nativeDetails(scope);
    if (current.rows !== snapshot.rows || current.updates === updates) return;
    patch(scope, { resources: withUpdates(current.resources, updates), updates });
  } catch (reason) { if (!(reason instanceof CacheInvalidatedError)) reportInstanceError(reason); }
}
export async function loadNativeWorlds(id: string, force = false) {
  if (force) worldCache.invalidate(id);
  return readNativeWorlds(id, force);
}
async function readNativeWorlds(id: string, force: boolean) {
  try {
    const worlds = await worldCache.read(id, async () => {
      const rows = await invoke<NativeWorld[]>('list_instance_worlds', { instanceId: Number(id), forceRefresh: force });
      const fallback = iconFor(id);
      return rows.map((row) => worldFromNative(row, fallback));
    });
    if (worldCache.peek(id)?.data === worlds) patch(id, { worlds });
  } catch (reason) { if (!(reason instanceof CacheInvalidatedError)) reportInstanceError(reason); }
}
export async function loadNativeScreenshots(id: string, force = false) {
  const record = nativeRecord(id); if (!record) return;
  if (force) screenshotCache.invalidate(id);
  try {
    const screenshots = await screenshotCache.read(id, async () => {
      const rows = await invoke<{ path: string; name: string; createdAt: number }[]>('get_screenshots', { instanceIdSlug: instanceSlug(record.name) });
      return rows.map((row) => ({ id: row.path, path: row.path, src: convertFileSrc(row.path), title: row.name, date: new Date(row.createdAt * 1000).toLocaleString() }));
    });
    if (screenshotCache.peek(id)?.data === screenshots) patch(id, { screenshots });
  } catch (reason) { if (!(reason instanceof CacheInvalidatedError)) reportInstanceError(reason); }
}
/** The mounted view owns events. Focus uses TTLs; real changes invalidate only affected data. */
export function useNativeDetails(id: string, world = false) {
  if (!nativeInstances) return;
  onSettled(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dirty = new Set<'resources' | 'worlds' | 'screenshots'>();
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => disposed ? stop() : stops.push(stop);
    const parentId = resourceScope(id).instanceId;
    const refresh = () => {
      if (disposed) return;
      void loadNativeResources(id);
      if (!world) { void loadNativeWorlds(id); void loadNativeScreenshots(id); }
    };
    const changed = (...parts: ('resources' | 'worlds' | 'screenshots')[]) => {
      if (disposed) return;
      for (const part of parts) {
        if (dirty.has(part) || (part === 'resources' && resourceMutations.has(id))) continue;
        dirty.add(part);
        if (part === 'resources') invalidateResources(id);
        if (part === 'worlds') worldCache.invalidate(id);
        if (part === 'screenshots') screenshotCache.invalidate(id);
      }
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const parts = [...dirty]; dirty.clear();
        if (disposed) return;
        for (const part of parts) {
          if (part === 'resources') void loadNativeResources(id);
          if (part === 'worlds' && !world) void readNativeWorlds(id, true);
          if (part === 'screenshots' && !world) void loadNativeScreenshots(id);
        }
      }, 80);
    };
    const register = <T>(event: string, receive: (value: T) => void) => listen<T>(event, ({ payload }) => { if (!disposed) receive(payload); }).then(keep);
    void Promise.all([
      ...['core://instance-resource-rows-changed', 'core://instance-resource-metadata-changed'].map((event) => register<{instanceId:number}>(event, (value) => { if (!world && String(value.instanceId) === parentId) changed('resources'); })),
      register<{instanceId:number}>('core://instance-worlds-changed', (value) => { if (!world && String(value.instanceId) === parentId) changed('worlds'); }),
      register<{world:{instanceId:number;directoryName:string}}>('core://world-datapacks-changed', (value) => {
        if (value.world && id === `${value.world.instanceId}/world/${value.world.directoryName}`) changed('resources');
      }),
      register<{id?:number;name:string}>('core://instance-installed', (value) => { if (String(value.id) === parentId || value.name === nativeRecord(parentId)?.name) changed('resources', 'worlds', 'screenshots'); }),
      register<{instance_id:string}>('core://instance-exited', (value) => { const record = nativeRecord(parentId); if (record && value.instance_id === instanceSlug(record.name)) changed('resources', 'worlds', 'screenshots'); }),
    ]).then(refresh).catch(reportInstanceError);
    window.addEventListener('focus', refresh);
    return () => { disposed = true; if (timer !== undefined) clearTimeout(timer); stops.forEach((stop) => stop()); window.removeEventListener('focus', refresh); };
  });
}

export function mutateNativeResources(scope: string, ids: string[], action: 'toggle' | 'delete' | 'update', enabled?: boolean) {
  const { instanceId, world } = resourceScope(scope);
  const snapshot = nativeDetails(scope);
  const rows = new Map(snapshot.rows.map((row) => [String(row.id), row]));
  const items = new Map(snapshot.resources.map((row) => [row.id, row]));
  return performNative(instanceId, async () => {
    if (action === 'delete' && ids.some((id) => items.get(id)?.bundled || rows.get(id)?.source_kind === 'modpack'))
      throw new Error(t('versions.bundled-follow-release'));
    resourceMutations.add(scope);
    invalidateResources(scope);
    try {
      for (const id of ids) {
        const resource = rows.get(id);
        const item = items.get(id);
        if (!resource || item?.readOnly) continue;
        if (action === 'update') {
          const version = snapshot.updates[id]; if (!version) continue;
          await invoke('install_resource', {
            target: world ? { kind: 'world', world } : { kind: 'instance', instanceId: Number(instanceId) },
            platform: resource.platform, projectId: resource.remote_id, projectName: resource.display_name,
            version, installType: resource.resource_type, replacementResourceId: resource.id, compatibilityAcknowledged: false,
          });
        } else {
          await invoke(world ? action === 'toggle' ? 'toggle_world_datapack' : 'delete_world_datapack' : action === 'toggle' ? 'toggle_resource' : 'delete_resource',
            { ...(world ? { worldRef: world } : { instanceId: Number(instanceId) }), resourceId: resource.id, ...(action === 'toggle' ? { enabled } : {}) });
        }
      }
    } finally {
      try { invalidateResources(scope); await untrack(() => loadNativeResources(scope)); }
      finally { resourceMutations.delete(scope); }
    }
  });
}
/** Reveal by scoped Ledger identity; never accept an arbitrary frontend filesystem path. */
export async function revealNativeResource(scope: string, resourceId: string) {
  const { instanceId, world } = resourceScope(scope);
  try {
    if (world && resourceId.startsWith('file:')) {
      await invoke('open_world_datapacks_folder', { worldRef: world });
    } else {
      await invoke('open_resource_in_folder', { instanceId: Number(instanceId), resourceId: Number(resourceId) });
    }
  } catch (reason) { reportInstanceError(reason); }
}
export const openNativeWorld = (id: string, directoryName: string) => performNative(id, () => invoke('open_world_folder', { worldRef: { instanceId: Number(id), directoryName } }), false);
export const deleteNativeWorld = (id: string, directoryName: string) => performNative(id, async () => {
  await invoke('delete_world', { worldRef: { instanceId: Number(id), directoryName } }); await loadNativeWorlds(id, true);
});
export const transferNativeWorld = (from: string, to: string, directoryName: string, move = false, acknowledged = false) => performNative(from, async () => {
  await invoke('transfer_world', {
    worldRef: { instanceId: Number(from), directoryName }, destinationInstanceId: Number(to),
    mode: from === to ? 'duplicate' : move ? 'move' : 'copy', riskAcknowledged: acknowledged,
  });
  await Promise.all([...new Set([from, to])].map((id) => loadNativeWorlds(id, true)));
});

export const mutateNativeScreenshot = (id: string, path: string, remove = false) => performNative(id, async () => {
  if (!untrack(() => nativeDetails(id).screenshots.some((shot) => shot.path === path))) throw new Error('Screenshot is no longer available');
  await invoke(remove ? 'delete_screenshot' : 'open_screenshot_in_folder', { path });
  if (remove) await loadNativeScreenshots(id, true);
});
