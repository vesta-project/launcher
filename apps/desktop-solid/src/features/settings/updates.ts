import { isTauri } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { createSignal } from 'solid-js';
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'current' | 'available' | 'error';
  version?: string;
  error?: string;
}
const [updateStatus, setStatus] = createSignal<UpdateStatus>({ state: 'idle' }, { name: 'launcherUpdateStatus' });
export { updateStatus };
let pending: Promise<void> | undefined;
export function checkForUpdates(): Promise<void> {
  if (pending) return pending;
  setStatus({ state: 'checking' });
  pending = (async () => {
    try {
      if (!isTauri()) { setStatus({ state: 'current' }); return; }
      const update = await check({ timeout: 30_000 });
      try { setStatus(update ? { state: 'available', version: update.version } : { state: 'current' }); }
      finally { await update?.close(); }
    } catch (reason) { setStatus({ state: 'error', error: String(reason) }); }
  })().finally(() => { pending = undefined; });
  return pending;
}
