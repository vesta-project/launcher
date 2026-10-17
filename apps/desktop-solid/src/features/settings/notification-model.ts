/** Rust notification records use snake_case (unlike settings sync). */
export interface NotificationSource {
  id: string;
  title: string;
  provider_type: string;
  target_url: string | null;
  target_id: string | null;
  metadata: string | null;
}
export interface NotificationSubscription extends Omit<NotificationSource, 'id'> {
  id: string;
  enabled: boolean;
}
export interface Feed {
  id: string;
  name: string;
  detail: string;
  enabled: boolean;
  custom: boolean;
}
export const toFeed = (source: NotificationSource | NotificationSubscription): Feed => ({
  id: source.id,
  name: source.title,
  detail: source.target_url ?? source.target_id ?? source.provider_type,
  enabled: 'enabled' in source ? source.enabled : true,
  custom: source.provider_type === 'rss',
});

/** A subscription gets a UUID, so matching preset IDs against it is incorrect. */
export function availableSources(sources: NotificationSource[], subscriptions: NotificationSubscription[]) {
  return sources.filter((source) => !subscriptions.some((subscription) =>
    subscription.provider_type === source.provider_type &&
    subscription.target_url === source.target_url && subscription.target_id === source.target_id,
  ));
}

export function rssFeedTitle(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('RSS feeds need an HTTP or HTTPS URL.');
  return parsed.hostname;
}
