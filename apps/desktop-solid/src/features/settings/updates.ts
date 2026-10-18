import { invoke, isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { createMemo, createRoot, createSignal, untrack } from 'solid-js';
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  progress?: number;
  error?: string;
}
export type UpdaterState =
  | { state: 'idle'; error?: string }
  | { state: 'available'; version: string; error?: string }
  | { state: 'downloading'; version: string; progress?: number }
  | { state: 'ready'; version: string; error?: string };
const [updateStatus, setStatus] = createSignal<UpdateStatus>({ state: 'idle' }, { name: 'launcherUpdateStatus' });
export { updateStatus };
export const updaterState = createRoot(() => createMemo<UpdaterState>(() => {
  const status = updateStatus();
  if (status.state === 'available' || status.state === 'downloading' || status.state === 'ready') return { ...status, state: status.state, version: status.version! };
  return { state: 'idle', error: status.error };
}, { name: 'titlebarUpdaterState', equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) }));
let pending: Promise<void> | undefined;
let downloading: Promise<void> | undefined;
let installing: Promise<void> | undefined;
let candidate: Update | undefined;
export function checkForUpdates(): Promise<void> {
  if (pending) return pending;
  if (downloading || installing || untrack(updateStatus).state === 'ready') return Promise.resolve();
  setStatus({ state: 'checking' });
  pending = (async () => {
    try {
      if (!isTauri()) { setStatus({ state: 'current' }); return; }
      const update = await check({ timeout: 30_000 });
      await candidate?.close();
      candidate = update ?? undefined;
      setStatus(update ? { state: 'available', version: update.version } : { state: 'current' });
    } catch (reason) { setStatus({ state: 'error', error: String(reason) }); }
  })().finally(() => { pending = undefined; });
  return pending;
}
export function downloadUpdate(): Promise<void> {
  if (downloading) return downloading;
  downloading = (async () => {
    if (pending) await pending;
    if (!candidate) await checkForUpdates();
    const update = candidate;
    if (!update || untrack(updateStatus).state === 'ready') return;
    let bytes = 0;
    let total: number | undefined;
    let last = 0;
    setStatus({ state: 'downloading', version: update.version });
    try {
      await update.download((event) => {
        if (event.event === 'Started') total = event.data.contentLength;
        if (event.event === 'Progress') bytes += event.data.chunkLength;
        const now = Date.now();
        if (event.event === 'Finished' || now - last >= 100) {
          last = now;
          setStatus({ state: 'downloading', version: update.version, progress: total ? Math.min(1, bytes / total) : undefined });
        }
      });
      setStatus({ state: 'ready', version: update.version });
    } catch (reason) { setStatus({ state: 'available', version: update.version, error: String(reason) }); throw reason; }
  })().finally(() => { downloading = undefined; });
  return downloading;
}
export function restartToUpdate(): Promise<void> {
  if (installing) return installing;
  if (!candidate || untrack(updateStatus).state !== 'ready') return Promise.resolve();
  const update = candidate;
  installing = (async () => {
    try {
      await update.install();
      await invoke('invoke_notification_action', { actionId: 'restart_app', clientKey: null, payload: null });
    } catch (reason) { setStatus({ state: 'ready', version: update.version, error: String(reason) }); throw reason; }
  })().finally(() => { installing = undefined; });
  return installing;
}
/** Browser fixtures only; production never fabricates updater availability. */
export function setUpdaterFixture(state: UpdaterState) {
  if (import.meta.env.DEV && !isTauri()) setStatus(state);
}
