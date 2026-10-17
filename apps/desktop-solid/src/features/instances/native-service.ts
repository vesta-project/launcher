import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createEffect, createSignal, onSettled, untrack } from 'solid-js';
import { activeAccount } from '../accounts/accounts';
import { CacheInvalidatedError, RequestCache } from '../../platform/cache/request-cache';
import { resolveInstanceIcon, stableIconId } from './icon-catalog';
import { instanceSlug, instanceState, preferencesPatch, type NativeInstance } from './native-model';
import type { InstancePreferences } from './preferences';

export const nativeInstances = typeof window !== 'undefined' && isTauri();
const catalog = new RequestCache<NativeInstance[]>({ maxEntries: 1, staleTimeMs: 30_000, retentionMs: 300_000 });
const [records, setRecords] = createSignal<NativeInstance[]>([], { name: 'nativeInstances' });
const [loaded, setLoaded] = createSignal(!nativeInstances, { name: 'nativeInstancesLoaded' });
const [error, setError] = createSignal<string | undefined>(undefined, { name: 'instanceServiceError' });
const [runtime, setRuntime] = createSignal<Record<string, 'warming' | 'running'>>({}, { name: 'instanceRuntime' });
const [deleting, setDeleting] = createSignal<Set<number>>(new Set(), { name: 'deletingInstances' });
const [pending, setPending] = createSignal<Set<number>>(new Set(), { name: 'instanceMutations' });
let scopeGeneration = 0;
let runtimeRevision = 0;
export const instanceCacheMetrics = () => ({ ...catalog.metrics });
export { records as nativeRecords, loaded as instancesLoaded, error as instanceError };
export const reportInstanceError = (reason: unknown) => setError(String(reason));
export const clearInstanceError = () => setError(undefined);
export const nativeRecord = (id: string) => records().find((record) => String(record.id) === id);
export const instancePending = (id: string) => pending().has(Number(id)) || deleting().has(Number(id));

export function displayImage(record: NativeInstance) {
  const path = record.iconPath || record.modpackIconUrl || 'builtin:placeholder-1';
  if (path.startsWith('internal:')) return resolveInstanceIcon('builtin:placeholder-1');
  if (/^(\/|[A-Za-z]:[\\/])/.test(path)) return convertFileSrc(path);
  return resolveInstanceIcon(path);
}
export const nativeEntries = () => records().map((record) => ({
  instance: { id: String(record.id), name: record.name, minecraftVersion: record.minecraftVersion,
    modloader: record.modloader || 'vanilla', image: displayImage(record) },
  state: deleting().has(record.id) ? { kind: 'installing' as const, label: 'Deleting' } : instanceState(record, runtime()[instanceSlug(record.name)]),
}));

export async function refreshNativeInstances(force = false) {
  if (!nativeInstances) return;
  const generation = scopeGeneration;
  if (force) catalog.invalidate('library');
  try { await catalog.read('library', () => invoke<NativeInstance[]>('list_instances').then((list) => list.map((record) => ({ ...record, iconData: null })))); }
  catch (reason) { if (!(reason instanceof CacheInvalidatedError) && generation === scopeGeneration) setError(String(reason)); }
  finally { if (generation === scopeGeneration) setLoaded(true); }
}

async function refreshRuntime() {
  const revision = runtimeRevision;
  const running = await invoke<{ instance_id: string }[]>('get_running_instances');
  if (revision === runtimeRevision) {
    setRuntime(Object.fromEntries(running.map((record) => [record.instance_id, 'running' as const])));
  }
}
function upsert(record: NativeInstance) {
  if (!Number.isInteger(record?.id)) { void refreshNativeInstances(true); return; }
  if (['guest', 'demo'].includes(activeAccount()?.account_type.toLowerCase() ?? '')) return;
  const previous = records().find((entry) => entry.id === record.id);
  const merged = { ...previous, ...record, iconData: null };
  if (!record.iconPath || record.iconPath.startsWith('internal:')) {
    merged.iconPath = previous?.iconPath ?? null;
  }
  const next = previous ? records().map((entry) => entry.id === record.id ? merged : entry) : [merged, ...records()];
  catalog.seed('library', next);
  if (!loaded() || record.iconPath?.startsWith('internal:')) void refreshNativeInstances(true);
}

/** Shell owns subscriptions. No eager metadata/network requests or tab services here. */
export function useInstanceSync() {
  if (!nativeInstances) return;
  const [ready, setReady] = createSignal(false, { name: 'instanceEventsReady' });
  let initialized = false;
  let accountScope: string | undefined;
  let unsubscribeCatalog: (() => void) | undefined;
  onSettled(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    const register = <T>(event: string, receive: (payload: T) => void) => listen<T>(event, (message) => {
      if (!disposed) receive(message.payload);
    }).then(keep);
    const updateRuntime = (slug: string, state?: 'warming' | 'running') => {
      runtimeRevision++;
      setRuntime((current) => { const next = { ...current }; if (state) next[slug] = state; else delete next[slug]; return next; });
    };
    const taskNotice = (notice: {severity:string;metadata?:string;description?:string;title:string}) => {
      if (notice.severity !== 'error' || !notice.metadata) return;
      try {
        const context = JSON.parse(notice.metadata).context;
        if (context?.kind === 'instance' && records().some((record)=>String(record.id) === context.id)) {
          setDeleting((current)=>{const next = new Set(current); next.delete(Number(context.id)); return next;});
          setError(notice.description || notice.title);
          void refreshNativeInstances(true);
        }
      } catch { /* unrelated/malformed notification metadata */ }
    };
    void Promise.all([
      ...['core://notification', 'core://notification-progress'].map((event)=>register(event, taskNotice)),
      ...['core://instance-created', 'core://instance-updated', 'core://instance-installed'].map((event) => register<NativeInstance>(event, upsert)),
      register<{instance_id:string}>('core://instance-crashed', () => { void refreshNativeInstances(true); }),
      register<{id:number}>('core://instance-deleted', ({id}) => {
        setDeleting((current)=>{const next = new Set(current);next.delete(id);return next;});
        catalog.seed('library', records().filter((entry) => entry.id !== id));
      }),
      register<{id:number}>('core://instance-delete-queued', ({id})=>setDeleting((current)=>new Set([...current,id]))),
      register<{instance_id:string}>('core://instance-launch-request', ({instance_id}) => updateRuntime(instance_id, 'warming')),
      register<{instance_id:string}>('core://instance-launched', ({instance_id}) => updateRuntime(instance_id, 'running')),
      ...['core://instance-killed', 'core://instance-exited'].map((event) => register<{instance_id:string}>(event, ({instance_id}) => {
        updateRuntime(instance_id); void refreshNativeInstances(true);
      })),
    ]).catch((reason) => setError(String(reason))).finally(() => { if (!disposed) setReady(true); });
    const focus = () => { if (!initialized) return; void refreshNativeInstances(); void refreshRuntime().catch((reason) => setError(String(reason))); };
    window.addEventListener('focus', focus);
    return () => { disposed = true; unsubscribeCatalog?.(); stops.forEach((stop) => stop()); window.removeEventListener('focus', focus); };
  });
  createEffect(() => ready() ? activeAccount()?.uuid ?? 'none' : undefined, (uuid) => {
    if (uuid === undefined || accountScope === uuid) return;
    accountScope = uuid;
    unsubscribeCatalog?.();
    scopeGeneration++;
    initialized = true;
    catalog.invalidateAll(true);
    setRecords([]);
    runtimeRevision++;
    setRuntime({});
    setLoaded(false);
    unsubscribeCatalog = catalog.subscribe('library', (snapshot) => {
      if (snapshot.hasData) setRecords(snapshot.data!);
      if (snapshot.error) setError(String(snapshot.error));
    });
    void refreshNativeInstances();
    void refreshRuntime().catch((reason) => setError(String(reason)));
  });
}

/** Resolve identity by numeric ID and fetch fresh settings before every mutation. */
export async function performNative(id: string, action: (record: NativeInstance) => Promise<unknown>): Promise<boolean> {
  const numeric = Number(id);
  if (!nativeInstances || !Number.isInteger(numeric) || numeric < 1) return false;
  if (instancePending(id)) return false;
  setPending((current) => new Set([...current, numeric]));
  setError(undefined);
  try {
    const record = await invoke<NativeInstance>('get_instance', { instanceId: numeric });
    await action(record);
    await refreshNativeInstances(true);
    return true;
  } catch (reason) { setError(String(reason)); return false; }
  finally { setPending((current) => { const next = new Set(current); next.delete(numeric); return next; }); }
}
export const resumeNativeInstance = (id: string) => performNative(id, (record) => invoke('resume_instance_operation', { instanceId: record.id }));
export const runInstance = (id: string) => performNative(id, async (record) => {
  if (await invoke<boolean>('is_instance_running', { instanceData: record })) {
    await invoke('kill_instance', { inst: record });
    await refreshRuntime();
  } else {
    const account = untrack(activeAccount);
    if (!account || ['guest', 'demo'].includes(account.account_type.toLowerCase())) throw new Error('Sign in with Microsoft to launch an instance.');
    const status = record.installationStatus;
    if (!status || status === 'pending' || status.startsWith('failed') || status === 'interrupted') {
      await invoke('resume_instance_operation', { instanceId: record.id });
    } else {
      const slug = instanceSlug(record.name);
      runtimeRevision++;
      setRuntime((current) => ({ ...current, [slug]: 'warming' }));
      try { await invoke('launch_instance', { instanceData: record }); }
      finally {
        runtimeRevision++;
        setRuntime((current) => { const next = { ...current }; delete next[slug]; return next; });
        await refreshRuntime();
      }
    }
  }
});
export const deleteNativeInstance = (id: string) => performNative(id, (record) => invoke('delete_instance', { instanceId: record.id }));
export const resetNativeInstance = (id: string) => performNative(id, (record) => invoke('reset_instance', { instanceId: record.id }));
export const repairNativeInstance = (id: string) => performNative(id, (record) => invoke('repair_instance', { instanceId: record.id }));
export const duplicateNativeInstance = (id: string) => performNative(id, (record) => invoke('duplicate_instance', { instanceId: record.id, newName: null }));
export const clearNativeCrash = (id: string) => performNative(id, (record) => invoke('clear_instance_crash', { instanceIdSlug: instanceSlug(record.name) }));
export const openNativeLogsFolder = (id: string) => performNative(id, (record) => invoke('open_logs_folder', { instanceIdSlug: instanceSlug(record.name) }));
export const openNativeInstanceFolder = (id: string) => performNative(id, (record) => invoke('open_instance_folder', { instanceIdSlug: instanceSlug(record.name) }));
export const saveNativeInstance = (id: string, name: string, image: string, preferences: InstancePreferences) => performNative(id, (record) => invoke('update_instance', {
  instanceData: { ...preferencesPatch(record, preferences), name: name.trim(), iconPath: image === displayImage(record) ? record.iconPath : stableIconId(image) },
}));

export const changeNativeEngine = (id: string, minecraft: string, loader: string, loaderVersion: string) => performNative(id, async (record) => {
  if (record.modpackId) throw new Error('Unlink the modpack before changing the Minecraft engine directly.');
  const changed = { ...record, minecraftVersion: minecraft, modloader: loader === 'vanilla' ? null : loader, modloaderVersion: loader === 'vanilla' ? null : loaderVersion };
  await invoke('update_instance', { instanceData: changed });
  const fresh = await invoke<NativeInstance>('get_instance', { instanceId: record.id });
  await invoke('install_instance', { instanceData: fresh });
});

const memoryCache = new RequestCache<number>({maxEntries:1, staleTimeMs:3_600_000, retentionMs:3_600_000});
const [systemMemory, setSystemMemory] = createSignal<number | undefined>(undefined, {name:'systemMemoryMb'});
export { systemMemory as systemMemoryMb };
export async function loadSystemMemory() {
  if (!nativeInstances) return;
  try { setSystemMemory(await memoryCache.read('memory',()=>invoke<number>('get_system_memory_mb'))); }
  catch (reason) { console.warn('Unable to read system memory:', reason); }
}
