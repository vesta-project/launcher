import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createSignal, onSettled, untrack } from 'solid-js';
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
const revisions = new Map<string, number>();
const patch = (id: string, values: Partial<DetailState>) => setData((all) => Object.fromEntries([
  ...Object.entries(all).filter(([key]) => key !== id).slice(-11), [id, { ...(all[id] ?? empty()), ...values }],
]));
function iconFor(id: string) { const record = nativeRecord(resourceScope(id).instanceId); return record ? displayImage(record) : ''; }

export async function loadNativeResources(scope: string) {
  const revision = (revisions.get(scope) ?? 0) + 1;
  revisions.set(scope, revision);
  const { instanceId, world } = resourceScope(scope);
  try {
    if (world) {
      const overview = await invoke<{ entries: NativeDatapack[] }>('list_world_datapacks', { worldRef: world });
      if (revisions.get(scope) !== revision) return;
      patch(scope, { resources: overview.entries.map((row) => ({
        id: row.resourceId === null ? `file:${row.fileName}` : String(row.resourceId), kind: 'datapack',
        filename: row.fileName, name: row.displayName, author: '', version: row.versionNumber ?? '',
        enabled: row.enabled, sizeKb: Math.ceil(row.sizeBytes / 1024), source: resourceSource(row.platform),
        icon: iconFor(scope), readOnly: row.readOnly || row.resourceId === null,
      })), rows: overview.entries.filter((row) => row.resourceId !== null).map((row) => ({
        id: row.resourceId!, platform: row.platform ?? '', remote_id: row.projectId ?? '', remote_version_id: row.versionId ?? '',
        resource_type: 'datapack', local_path: row.fileName, display_name: row.displayName,
        current_version: row.versionNumber ?? '', is_manual: !row.managed, is_enabled: row.enabled,
        file_size: row.sizeBytes, source_kind: '',
      })) });
      const checked = await invoke<{ updates: { resourceId: number; exactVersion: NativeVersion | null }[] }>('check_world_datapack_updates', { worldRef: world, forceRefresh: false });
      if (revisions.get(scope) !== revision) return;
      const updates = Object.fromEntries(checked.updates.filter((row) => row.exactVersion).map((row) => [String(row.resourceId), row.exactVersion!]));
      patch(scope, { updates, resources: nativeDetails(scope).resources.map((row) => ({ ...row, update: updates[row.id]?.version_number })) });
    } else {
      const overview = await invoke<{ resources: NativeResource[]; projectRecords: { id: string; source: string; icon_url?: string }[] }>('get_instance_resource_overview', { instanceId: Number(instanceId) });
      if (revisions.get(scope) !== revision) return;
      const rows = overview.resources;
      const mapped = (updates: Record<string, NativeVersion>) => rows.map((row) => resourceFromNative(row,
        overview.projectRecords.find((project) => project.id === row.remote_id && project.source === row.platform)?.icon_url || iconFor(scope), updates[row.id]));
      patch(scope, { rows, resources: mapped({}), updates: {} });
      const checked = await invoke<{ resourceUpdates: { resourceId: number; version: NativeVersion }[] }>('check_instance_updates_lightweight', { instanceId: Number(instanceId), forceRefresh: false });
      if (revisions.get(scope) !== revision) return;
      const updates = Object.fromEntries(checked.resourceUpdates.map((row) => [String(row.resourceId), row.version]));
      patch(scope, { resources: mapped(updates), updates });
    }
  } catch (reason) { if (revisions.get(scope) === revision) reportInstanceError(reason); }
}
export async function loadNativeWorlds(id: string) {
  const key = `${id}:worlds`, revision = (revisions.get(`${id}:worlds`) ?? 0) + 1;
  revisions.set(key, revision);
  try {
    const rows = await invoke<NativeWorld[]>('list_instance_worlds', { instanceId: Number(id), forceRefresh: true });
    if (revisions.get(key) !== revision) return;
    patch(id, { worlds: rows.map((row) => worldFromNative(row, iconFor(id))) });
  } catch (reason) { reportInstanceError(reason); }
}
export async function loadNativeScreenshots(id: string) {
  const record = nativeRecord(id); if (!record) return;
  const key = `${id}:screenshots`, revision = (revisions.get(`${id}:screenshots`) ?? 0) + 1;
  revisions.set(key, revision);
  try {
    const rows = await invoke<{ path: string; name: string; createdAt: number }[]>('get_screenshots', { instanceIdSlug: instanceSlug(record.name) });
    if (revisions.get(key) !== revision) return;
    patch(id, { screenshots: rows.map((row) => ({ id: row.path, path: row.path, src: convertFileSrc(row.path), title: row.name, date: new Date(row.createdAt * 1000).toLocaleString() })) });
  } catch (reason) { reportInstanceError(reason); }
}
/** The mounted instance owns subscriptions and revalidation; getters never trigger IPC. */
export function useNativeDetails(id: string, world = false) {
  if (!nativeInstances) return;
  onSettled(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => disposed ? stop() : stops.push(stop);
    const parentId = resourceScope(id).instanceId;
    const resources = () => { if (!disposed) void loadNativeResources(id); };
    const worlds = () => { if (!disposed && !world) void loadNativeWorlds(id); };
    const refresh = () => { resources(); worlds(); if (!world) void loadNativeScreenshots(id); };
    const register = <T>(event: string, receive: (value: T) => void) => listen<T>(event, ({ payload }) => { if (!disposed) receive(payload); }).then(keep);
    void Promise.all([
      ...['core://instance-resource-rows-changed', 'core://instance-resource-metadata-changed'].map((event) => register<{instanceId:number}>(event, (value) => { if (String(value.instanceId) === parentId) resources(); })),
      register<{instanceId:number}>('core://instance-worlds-changed', (value) => { if (String(value.instanceId) === parentId) worlds(); }),
      register<{world:{instanceId:number;directoryName:string}}>('core://world-datapacks-changed', (value) => {
        if (value.world && id === `${value.world.instanceId}/world/${value.world.directoryName}`) resources();
      }),
      register<{id?:number;name:string}>('core://instance-installed', (value) => { if (String(value.id) === parentId || value.name === nativeRecord(parentId)?.name) refresh(); }),
      register<{instance_id:string}>('core://instance-exited', (value) => { const record = nativeRecord(parentId); if (record && value.instance_id === instanceSlug(record.name)) refresh(); }),
    ]).then(refresh).catch(reportInstanceError);
    window.addEventListener('focus', refresh);
    return () => { disposed = true; stops.forEach((stop) => stop()); window.removeEventListener('focus', refresh); for (const key of [id, `${id}:worlds`, `${id}:screenshots`]) revisions.set(key, (revisions.get(key) ?? 0) + 1); };
  });
}

export function mutateNativeResources(scope: string, ids: string[], action: 'toggle' | 'delete' | 'update', enabled?: boolean) {
  const { instanceId, world } = resourceScope(scope);
  const snapshot = nativeDetails(scope);
  return performNative(instanceId, async () => {
    try {
      for (const id of ids) {
        const resource = snapshot.rows.find((row) => String(row.id) === id);
        const item = snapshot.resources.find((row) => row.id === id);
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
    } finally { await untrack(() => loadNativeResources(scope)); }
  });
}
export const openNativeWorld = (id: string, directoryName: string) => performNative(id, () => invoke('open_world_folder', { worldRef: { instanceId: Number(id), directoryName } }));
export const deleteNativeWorld = (id: string, directoryName: string) => performNative(id, async () => {
  await invoke('delete_world', { worldRef: { instanceId: Number(id), directoryName } }); await loadNativeWorlds(id);
});
export const transferNativeWorld = (from: string, to: string, directoryName: string, move = false, acknowledged = false) => performNative(from, () => invoke('transfer_world', {
  worldRef: { instanceId: Number(from), directoryName }, destinationInstanceId: Number(to),
  mode: from === to ? 'duplicate' : move ? 'move' : 'copy', riskAcknowledged: acknowledged,
}));

export const mutateNativeScreenshot = (id: string, path: string, remove = false) => performNative(id, async () => {
  if (!untrack(() => nativeDetails(id).screenshots.some((shot) => shot.path === path))) throw new Error('Screenshot is no longer available');
  await invoke(remove ? 'delete_screenshot' : 'open_screenshot_in_folder', { path });
  if (remove) await loadNativeScreenshots(id);
});
