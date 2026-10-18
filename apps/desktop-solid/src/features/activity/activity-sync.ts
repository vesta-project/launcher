import { untrack } from 'solid-js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { configureActivityCancellation, receiveActivity, reportActivityError, stopActivityTimers, activities } from './activity-store';
import { receiveNotification, updateNotification, type HostNotification } from './notifications';
import { checkForUpdates, downloadUpdate, restartToUpdate } from '../settings/updates';
import { nativeRecord, displayImage } from '../instances/native-service';
import type { ActivityPatch } from './activity-model';

interface Context { kind?: string; id?: string; label?: string; iconUrl?: string }
interface TaskEvent extends ActivityPatch { context?: Context; totalSteps?: number }
interface ProgressEvent { id: string; progress?: number | null; step?: string | null; title?: string; currentStep?: number | null; totalSteps?: number | null }
function target(context?: Context) {
  if (context?.kind === 'instance' && context.id) return { instanceId: context.id };
  return undefined;
}
function taskEvent(event: TaskEvent) {
  const { context, totalSteps, ...raw } = event;
  const patch = Object.fromEntries(Object.entries(raw).filter(([, value]) => value != null)) as ActivityPatch;
  const record = context?.kind === 'instance' && context.id ? untrack(() => nativeRecord(context.id!)) : undefined;
  receiveActivity({ ...patch, ...(record ? { icon: displayImage(record), subtitle: [record.minecraftVersion, record.modloader].filter(Boolean).join(' · ') } : {}), ...(context ? { target: patch.target ?? target(context), ...(context.iconUrl ? { icon: context.iconUrl } : {}), iconFallback: context.label?.slice(0, 2) } : {}),
    ...(totalSteps && totalSteps > 0 ? { weight: totalSteps } : {}) });
}
/** Legacy progress snapshot hydration. Dedicated lifecycle events remain authoritative. */
function seedProgress(row: HostNotification) {
  if (row.notification_type !== 'progress' || row.client_key === 'app_update') return;
  let context: Context | undefined;
  try { context = JSON.parse(row.metadata || '{}').context; } catch { /* legacy metadata */ }
  const id = row.client_key || String(row.id);
  if (untrack(activities).some((a) => a.id === id)) return;
  receiveActivity({ id, title: row.title, kind: id.startsWith('generate_manifest') ? 'background' : 'task', state: 'running',
    progress: row.progress != null && row.progress >= 0 ? row.progress / 100 : undefined,
    step: row.description ?? undefined, target: target(context), icon: context?.iconUrl,
    startedAt: Date.parse(row.created_at ?? '') || Date.now(), cancellable: !!row.actions?.some((a) => a.id === 'cancel_task') });
}
let owners = 0;
let release: (() => void) | undefined;
/** Ref-counted, shell-owned connection. Register once at app startup; returns cleanup. */
export function startActivitySync(): () => void {
  if (!isTauri()) return () => {};
  if (++owners === 1) {
    let disposed = false;
    const stops: UnlistenFn[] = [];
    const inboxTouched = new Set<string>();
    let inboxCleared = false;
    let hydratingInbox = true;
    const inboxEvent = (row: HostNotification) => {
      if (hydratingInbox && row.client_key) inboxTouched.add(row.client_key);
      if (hydratingInbox && row.id != null) inboxTouched.add(String(row.id));
      receiveNotification(row);
    };
    const inboxUpdate = (patch: Parameters<typeof updateNotification>[0]) => {
      if (hydratingInbox && patch.client_key) inboxTouched.add(patch.client_key);
      if (hydratingInbox && patch.id != null) inboxTouched.add(String(patch.id));
      if (patch.cleared_all) inboxCleared = true;
      updateNotification(patch);
    };
    const register = async <T>(name: string, handler: (event: T) => void) => {
      const stop = await listen<T>(name, ({ payload }) => { if (!disposed) handler(payload); });
      if (disposed) stop(); else stops.push(stop);
    };
    configureActivityCancellation((id) => invoke('cancel_task', { clientKey: id }));
    release = () => { disposed = true; stops.forEach((stop) => stop()); stopActivityTimers(); };
    void (async () => {
      await Promise.all([
        register<TaskEvent>('core://activity', taskEvent),
        register<ProgressEvent>('core://activity-progress', (event) => {
          const patch: ActivityPatch = { id: event.id };
          if (event.progress != null) patch.progress = event.progress >= 0 ? event.progress / 100 : undefined;
          if (event.step != null) patch.step = event.step;
          if (event.title !== undefined) patch.title = event.title;
          if (event.currentStep != null) patch.currentStep = event.currentStep;
          if (event.totalSteps != null) patch.totalSteps = event.totalSteps;
          if (event.totalSteps && event.totalSteps > 0) patch.weight = Math.max(1, event.totalSteps - (event.currentStep ?? 0));
          receiveActivity(patch, true);
        }),
        register<HostNotification>('core://notification', inboxEvent),
        register<HostNotification>('core://notification-progress', inboxEvent),
        register<Parameters<typeof updateNotification>[0]>('core://notification-updated', inboxUpdate),
        register('core://check-for-updates', () => { void checkForUpdates(); }),
        register('core://download-app-update', () => { void downloadUpdate().catch(reportActivityError); }),
        register('core://install-app-update', () => { void restartToUpdate().catch(reportActivityError); }),
      ]);
      // Subscribe before snapshot; never overwrite lifecycle events already received.
      const rows = await invoke<HostNotification[]>('list_notifications', { filters: null });
      if (disposed) return;
      rows.reverse().forEach((row) => {
        seedProgress(row);
        if (!inboxCleared && !inboxTouched.has(row.client_key ?? '') && !inboxTouched.has(String(row.id))) receiveNotification(row);
      });
      hydratingInbox = false;
      inboxTouched.clear();
    })().catch(reportActivityError);
  }
  let released = false;
  return () => { if (!released && --owners === 0) { release?.(); release = undefined; } released = true; };
}
