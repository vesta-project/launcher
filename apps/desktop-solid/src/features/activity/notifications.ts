import { createMemo, createRoot, createSignal } from 'solid-js';
import { invoke, isTauri } from '@tauri-apps/api/core';
export interface HostNotification {
  id?: number | null;
  client_key?: string | null;
  title: string;
  description?: string | null;
  severity: 'info' | 'success' | 'warning' | 'error';
  notification_type: 'immediate' | 'progress' | 'patient';
  progress?: number | null;
  current_step?: number | null;
  total_steps?: number | null;
  metadata?: string | null;
  actions?: { id: string; label: string; type: string; payload?: unknown }[];
  read: boolean;
  created_at?: string;
  updated_at?: string;
}
export const notificationKey = (row: HostNotification) => row.client_key || String(row.id);
const [list, setList] = createSignal<readonly HostNotification[]>([], { name: 'attentionInbox' });
const unreadCount = createRoot(() => createMemo(() => list().filter((a) => !a.read).length, { name: 'attentionUnread' }));
const updaterKeys = new Set(['app_update', 'launcher_update']);
export function receiveNotification(row: HostNotification) {
  if (row.notification_type === 'progress' || updaterKeys.has(row.client_key ?? '') || (row.progress != null && row.severity !== 'error')) return;
  setList((old) => [row, ...old.filter((a) => notificationKey(a) !== notificationKey(row))].slice(0, 100));
}
export function updateNotification(patch: { id?: number; client_key?: string; read?: boolean; deleted?: boolean; cleared_all?: boolean }) {
  if (patch.cleared_all) { setList([]); return; }
  setList((old) => old.flatMap((a) => (patch.client_key && a.client_key === patch.client_key) || (patch.id !== undefined && a.id === patch.id)
    ? patch.deleted ? [] : [{ ...a, read: patch.read ?? a.read }] : [a]));
}
async function markRead(id: string) {
  if (isTauri()) await invoke('mark_notification_read', { id });
  setList((old) => old.map((a) => notificationKey(a) === id ? { ...a, read: true } : a));
}
async function dismiss(id: string) {
  if (isTauri()) await invoke('delete_notification', { id });
  setList((old) => old.filter((a) => notificationKey(a) !== id));
}
export const notifications = { list, unreadCount, markRead, dismiss };
