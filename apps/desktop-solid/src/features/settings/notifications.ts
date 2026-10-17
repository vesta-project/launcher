import { invoke, isTauri } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { cachedResource } from './cached-resource';
import { subscriptionCatalog, rssFeedTitle, type NotificationSource, type NotificationSubscription } from './notification-model';

const native = typeof window !== 'undefined' && isTauri();
const presets: NotificationSource[] = [
  { id: 'mojang_news', title: 'Minecraft News', provider_type: 'news', target_url: 'https://launchercontent.mojang.com/v2/news.json', target_id: null, metadata: null },
  { id: 'patch_notes', title: 'Java Patch Notes', provider_type: 'patch_notes', target_url: null, target_id: null, metadata: null },
  { id: 'minecraft_versions', title: 'Minecraft Version Updates', provider_type: 'game', target_url: null, target_id: null, metadata: null },
  { id: 'fabric_news', title: 'Fabric News', provider_type: 'rss', target_url: 'https://fabricmc.net/feed.xml', target_id: null, metadata: null },
];
const preview = { subscriptions: [{ ...presets[0]!, id: 'preview:mojang_news', enabled: true }], sources: presets };
export const notificationSubscriptions = cachedResource<{ subscriptions: NotificationSubscription[]; sources: NotificationSource[] }>({
  key: 'notification-subscriptions',
  fallback: native ? { subscriptions: [] as NotificationSubscription[], sources: [] as NotificationSource[] } : preview,
  load: async (): Promise<{ subscriptions: NotificationSubscription[]; sources: NotificationSource[] }> => {
    if (!native) return notificationSubscriptions.data();
    const [subscriptions, sources] = await Promise.all([
      invoke<NotificationSubscription[]>('get_notification_subscriptions'),
      invoke<NotificationSource[]>('get_available_notification_sources'),
    ]);
    return { subscriptions, sources };
  },
});
export const subscriptionEntries = () => {
  const { sources, subscriptions } = notificationSubscriptions.data();
  return subscriptionCatalog(sources, subscriptions);
};
const [error, setError] = createSignal('', { name: 'notificationSubscriptionError' });
const [checkedAt, setCheckedAt] = createSignal<Date | undefined>(undefined, { name: 'notificationLastCheck' });
const [checking, setChecking] = createSignal(false, { name: 'notificationChecking' });
export const notificationError = () => error() || (notificationSubscriptions.error() ? String(notificationSubscriptions.error()) : "");
export { checkedAt as notificationsCheckedAt, checking as notificationsChecking };
let writes = Promise.resolve();
function mutate(command: string, args: Record<string, unknown>, fallback: () => void) {
  writes = writes.then(async () => {
    setError('');
    try {
      if (native) {
        await invoke(command, args);
        await notificationSubscriptions.refresh(true);
      } else fallback();
    } catch (reason) { setError(String(reason)); }
  });
  return writes;
}
/** Switches a catalogue entry: toggles the stored subscription, or subscribes to the source first. */
export function setNotificationSubscription(entry: { sourceId?: string; subscriptionId?: string }, enabled: boolean) {
  const { subscriptionId, sourceId } = entry;
  if (subscriptionId) {
    return mutate('toggle_notification_subscription', { id: subscriptionId, enabled }, () => {
      const data = notificationSubscriptions.data();
      notificationSubscriptions.set({ ...data, subscriptions: data.subscriptions.map((item) => item.id === subscriptionId ? { ...item, enabled } : item) });
    });
  }
  const source = notificationSubscriptions.data().sources.find((item) => item.id === sourceId);
  if (!source || !enabled) return Promise.resolve();
  return mutate('subscribe_to_preset_source', { source }, () => {
    const data = notificationSubscriptions.data();
    notificationSubscriptions.set({ ...data, subscriptions: [...data.subscriptions, { ...source, id: `preview:${source.id}`, enabled: true }] });
  });
}
export const deleteNotificationFeed = (id: string) => mutate('delete_notification_subscription', { id }, () => {
  const data = notificationSubscriptions.data();
  notificationSubscriptions.set({ ...data, subscriptions: data.subscriptions.filter((item) => item.id !== id) });
});
export function subscribeToRss(url: string, title?: string) {
  url = url.trim();
  try { title ??= rssFeedTitle(url); }
  catch (reason) { setError(String(reason)); return Promise.resolve(); }
  const feedTitle = title;
  return mutate('subscribe_to_rss', { url, title: feedTitle }, () => {
    const data = notificationSubscriptions.data();
    notificationSubscriptions.set({ ...data, subscriptions: [...data.subscriptions, {
      id: url, title: feedTitle, provider_type: 'rss', target_url: url, target_id: null, metadata: null, enabled: true,
    }] });
  });
}
export async function checkNotificationsNow() {
  if (checking()) return;
  setChecking(true);
  setError('');
  try {
    if (native) await invoke('check_notifications_now');
    setCheckedAt(new Date());
    await notificationSubscriptions.refresh(true);
  } catch (reason) { setError(String(reason)); }
  finally { setChecking(false); }
}
