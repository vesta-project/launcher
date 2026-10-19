import { untrack } from 'solid-js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { configureActivityCancellation, receiveActivity, reportActivityError, stopActivityTimers, activities, retireHostActivities, flushActivityProgress } from './activity-store';
import { receiveNotification, updateNotification, type HostNotification } from './notifications';
import { checkForUpdates, downloadUpdate, restartToUpdate } from '../settings/updates';
import { nativeRecord, displayImage } from '../instances/native-service';
import type { ActivityPatch } from './activity-model';
import { ActivityRecovery, type ActivityEvent, type ActivitySnapshot, type NativeActivity } from './activity-recovery';

const hostIds = new Set<string>();
/** Full native rows normalize percentages once; notifications never imply running work. */
function taskEvent(event: NativeActivity) {
  const { context, totalSteps, currentStep, progress, overallProgress, ...raw } = event;
  const record = context?.kind === 'instance' && context.id ? untrack(() => nativeRecord(context.id!)) : undefined;
  const patch: ActivityPatch = {
    ...raw,
    progress: progress != null && progress >= 0 ? progress / 100 : undefined,
    overallProgress: overallProgress != null && overallProgress >= 0 ? overallProgress / 100 : undefined,
    currentStep: currentStep ?? undefined, totalSteps: totalSteps ?? undefined,
    ...(record ? { icon: displayImage(record), subtitle: [record.minecraftVersion, record.modloader].filter(Boolean).join(' · ') } : {}),
    ...(context ? {
      target: raw.target ?? (context.kind === 'instance' && context.id ? { instanceId: context.id } : undefined),
      ...(context.iconUrl ? { icon: context.iconUrl } : {}), iconFallback: context.label?.slice(0, 2),
    } : {}),
    weight: totalSteps && totalSteps > 0 ? Math.max(1, totalSteps - (currentStep ?? 0)) : undefined,
  };
  const previous = untrack(activities).find((activity) => activity.id === event.id);
  receiveActivity(patch, previous?.attempt === event.attempt && previous?.state === event.state && (event.state === 'running' || event.state === 'queued'));
}
let owners = 0;
let release: (() => void) | undefined;
/** Ref-counted, shell-owned connection. Register once at app startup; returns cleanup. */
export function startActivitySync(): () => void {
  if (!isTauri()) return () => {};
  if (++owners === 1) {
    let disposed = false;
    const stops: UnlistenFn[] = [];
    const recovery = new ActivityRecovery(hostIds, taskEvent, retireHostActivities);
    let snapshotRequest: Promise<void> | undefined;
    let snapshotAgain = false;
    const refreshActivities = (changedEpoch = false) => {
      if (disposed) return Promise.resolve();
      if (snapshotRequest) {
        snapshotAgain ||= changedEpoch;
        return snapshotRequest;
      }
      const epochAtRequest = recovery.epoch;
      snapshotRequest = invoke<ActivitySnapshot>('get_activity_snapshot').then((snapshot) => {
        if (disposed) return;
        // A live event from another backend lifetime supersedes an older reply.
        if (recovery.epoch !== epochAtRequest && recovery.epoch !== snapshot.epoch) return;
        recovery.snapshot(snapshot);
        flushActivityProgress();
      }).catch((error) => { if (!disposed) reportActivityError(error); })
        .finally(() => {
          snapshotRequest = undefined;
          if (snapshotAgain && !disposed) { snapshotAgain = false; void refreshActivities(); }
        });
      return snapshotRequest;
    };
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
      try {
        const stop = await listen<T>(name, ({ payload }) => { if (!disposed) handler(payload); });
        if (disposed) stop(); else stops.push(stop);
      } catch (error) { if (!disposed) reportActivityError(error); }
    };
    configureActivityCancellation((id) => invoke('cancel_task', { clientKey: id }));
    const focus = () => { void refreshActivities(); };
    release = () => {
      disposed = true;
      window.removeEventListener('focus', focus);
      stops.forEach((stop) => stop()); stopActivityTimers();
    };
    void (async () => {
      await Promise.all([
        register<ActivityEvent>('core://activity-state', (event) => {
          if (!recovery.receive(event)) void refreshActivities(true);
          else if (recovery.needsCompaction) void refreshActivities();
        }),
        register<HostNotification>('core://notification', inboxEvent),
        register<HostNotification>('core://notification-progress', inboxEvent),
        register<Parameters<typeof updateNotification>[0]>('core://notification-updated', inboxUpdate),
        register('core://check-for-updates', () => { void checkForUpdates(); }),
        register('core://download-app-update', () => { void downloadUpdate().catch(reportActivityError); }),
        register('core://install-app-update', () => { void restartToUpdate().catch(reportActivityError); }),
      ]);
      if (disposed) return;
      window.addEventListener('focus', focus);
      // Task recovery and attention-inbox hydration are independent reads.
      await Promise.all([
        refreshActivities(),
        invoke<HostNotification[]>('list_notifications', { filters: null }).then((rows) => {
          if (disposed) return;
          rows.reverse().forEach((row) => {
            if (!inboxCleared && !inboxTouched.has(row.client_key ?? '') && !inboxTouched.has(String(row.id))) receiveNotification(row);
          });
        }).catch((error) => { if (!disposed) reportActivityError(error); }),
      ]);
      if (disposed) return;
      hydratingInbox = false;
      inboxTouched.clear();
    })().catch(reportActivityError);
  }
  let released = false;
  return () => { if (!released && --owners === 0) { release?.(); release = undefined; } released = true; };
}
