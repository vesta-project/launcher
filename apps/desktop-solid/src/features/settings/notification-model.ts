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

export type SubscriptionGroup = 'minecraft' | 'loaders' | 'projects' | 'custom';
export const subscriptionGroups: readonly SubscriptionGroup[] = ['minecraft', 'loaders', 'projects', 'custom'];

/** One row of the subscription chooser: a catalogue source and/or the stored subscription behind it. */
export interface CatalogEntry {
  key: string;
  /** The catalogue source id, when the host offers this subscription. */
  sourceId?: string;
  /** The stored subscription id; absent until the user first subscribes. */
  subscriptionId?: string;
  name: string;
  detail: string;
  group: SubscriptionGroup;
  enabled: boolean;
  /** User-added subscriptions can be removed; catalogue ones can only be switched off. */
  removable: boolean;
}

const sameTarget = (a: NotificationSource, b: NotificationSource) =>
  a.provider_type === b.provider_type && a.target_url === b.target_url && a.target_id === b.target_id;
const sameSource = (a: NotificationSource, b: NotificationSource) => sameTarget(a, b) && a.metadata === b.metadata;
const groupOf = (source: NotificationSource): SubscriptionGroup =>
  source.provider_type === 'resource' ? 'projects' : source.provider_type === 'rss' ? 'loaders' : 'minecraft';

/**
 * Merges the host catalogue with stored subscriptions. Catalogue sources always appear, switched on
 * when a matching subscription is enabled. Subscriptions outside the catalogue (custom feeds,
 * followed projects) follow after. Sources that share a target (NeoForge) match by metadata first.
 */
export function subscriptionCatalog(
  sources: NotificationSource[],
  subscriptions: NotificationSubscription[],
): CatalogEntry[] {
  const claimed = new Set<string>();
  const entries: CatalogEntry[] = sources.map((source) => {
    const subscription =
      subscriptions.find((item) => !claimed.has(item.id) && sameSource(item, source)) ??
      subscriptions.find(
        (item) =>
          !claimed.has(item.id) && sameTarget(item, source) && !sources.some((other) => sameSource(item, other)),
      );
    if (subscription) claimed.add(subscription.id);
    return {
      key: `source:${source.id}`,
      sourceId: source.id,
      subscriptionId: subscription?.id,
      name: source.title,
      detail: source.target_url ?? source.target_id ?? source.provider_type,
      group: groupOf(source),
      enabled: subscription?.enabled ?? false,
      removable: false,
    };
  });
  for (const subscription of subscriptions) {
    if (claimed.has(subscription.id)) continue;
    entries.push({
      key: `subscription:${subscription.id}`,
      subscriptionId: subscription.id,
      name: subscription.title,
      detail: subscription.target_url ?? subscription.target_id ?? subscription.provider_type,
      group: subscription.provider_type === 'resource' ? 'projects' : subscription.provider_type === 'rss' ? 'custom' : 'minecraft',
      enabled: subscription.enabled,
      removable: true,
    });
  }
  return entries;
}
