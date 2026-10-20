import { IconTile } from '../../../components/icon-tile';
import { Button, IconButton, Switch, TextField } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { setting, updateSetting } from '../../../features/settings/config';
import {
  notificationSubscriptions,
  subscriptionEntries,
  notificationsCheckedAt,
  notificationsChecking,
  notificationError,
  checkNotificationsNow,
  setNotificationSubscription,
  deleteNotificationFeed,
  subscribeToRss,
} from '../../../features/settings/notifications';
import {
  subscriptionGroups,
  type CatalogEntry,
  type SubscriptionGroup,
} from '../../../features/settings/notification-model';
import { t } from '../../../localization';
import { Card, ToggleRow } from '../parts';
import './notifications.css';

const groupTitle = (group: SubscriptionGroup) =>
  group === 'minecraft'
    ? t('prefs.notifications.group-minecraft')
    : group === 'loaders'
      ? t('prefs.notifications.group-loaders')
      : group === 'projects'
        ? t('prefs.notifications.group-projects')
        : t('prefs.notifications.group-custom');
const groupDescription = (group: SubscriptionGroup) =>
  group === 'minecraft'
    ? t('prefs.notifications.group-minecraft-description')
    : group === 'loaders'
      ? t('prefs.notifications.group-loaders-description')
      : group === 'projects'
        ? t('prefs.notifications.group-projects-description')
        : t('prefs.notifications.group-custom-description');
/** One-line description of a catalogue source; other subscriptions show their address. */
function entryDetail(entry: CatalogEntry) {
  switch (entry.sourceId) {
    case 'mojang_news':
      return t('prefs.notifications.source-mojang-news');
    case 'patch_notes':
      return t('prefs.notifications.source-patch-notes');
    case 'minecraft_versions':
      return t('prefs.notifications.source-minecraft-versions');
    case 'fabric_news':
      return t('prefs.notifications.source-fabric-news');
    case 'quilt_news':
      return t('prefs.notifications.source-quilt-news');
    case 'forge_releases':
      return t('prefs.notifications.source-forge-releases');
    case 'neoforge_releases':
      return t('prefs.notifications.source-neoforge-releases');
    case 'neoforge_announcements':
      return t('prefs.notifications.source-neoforge-announcements');
    default:
      return entry.detail;
  }
}

/** Native subscriptions, with an isolated browser preview. */
export function NotificationsSettings() {
  const resource = notificationSubscriptions;
  const entries = subscriptionEntries;
  const checkedAt = notificationsCheckedAt;
  const [address, setAddress] = createSignal('');
  const validAddress = () => /^https?:\/\/\S+\.\S+/.test(address().trim());
  const addFeed = async () => {
    if (!validAddress()) return;
    await subscribeToRss(address().trim());
    if (!notificationError()) setAddress('');
  };
  return (
    <>
      <Show when={notificationError()}>
        <p role="alert">{notificationError()}</p>
      </Show>
      <Card>
        <ToggleRow
          label={t('prefs.notifications.enabled')}
          description={t('prefs.notifications.enabled-description')}
          checked={setting('notification_enabled')}
          onChange={(value) => updateSetting('notification_enabled', value)}
        />
      </Card>

      <Card
        title={t('prefs.notifications.sources')}
        description={t('prefs.notifications.sources-description')}
        action={
          <Button
            size="sm"
            variant="outline"
            icon={<Icon name="icons/actions/refresh" />}
            disabled={notificationsChecking()}
            onClick={() => void checkNotificationsNow()}
          >
            {t('prefs.notifications.check-now')}
          </Button>
        }
      >
        <Show when={!resource.ready() && !resource.error()}>
          <p data-vesta="prefs-empty-line" role="status">
            {t('prefs.notifications.loading')}
          </p>
        </Show>
        <Show when={resource.error() && !entries().length}>
          <div data-vesta="prefs-add-feed">
            <p data-vesta="prefs-empty-line" role="alert">
              {t('prefs.notifications.load-failed')}
            </p>
            <Button size="sm" variant="outline" onClick={() => void resource.refresh(true)}>
              {t('prefs.notifications.retry')}
            </Button>
          </div>
        </Show>
        <Show when={resource.ready() && !resource.error() && !entries().length}>
          <p data-vesta="prefs-empty-line">{t('prefs.notifications.none')}</p>
        </Show>
        <Show when={checkedAt()}>
          {(time) => (
            <p data-vesta="prefs-note-line">
              {t('prefs.notifications.checked', {
                time: time().toLocaleTimeString(),
              })}
            </p>
          )}
        </Show>
      </Card>

      <For each={subscriptionGroups}>
        {(group) => (
          <Show when={entries().some((entry) => entry.group === group)}>
            <Card title={groupTitle(group)} description={groupDescription(group)}>
              <ul data-vesta="prefs-feeds">
                <For each={entries().filter((entry) => entry.group === group)}>
                  {(entry) => (
                    <li>
                      <IconTile hook="prefs-feed-icon" size={32} tone="accent">
                        <Icon name={group === 'custom' ? 'icons/content/link' : 'icons/status/bell'} size={16} />
                      </IconTile>
                      <div>
                        <strong>{entry.name}</strong>
                        <span>{entryDetail(entry)}</span>
                      </div>
                      <Switch
                        size="sm"
                        aria-label={entry.name}
                        checked={entry.enabled}
                        onChange={(on) => void setNotificationSubscription(entry, on)}
                      />
                      <Show when={entry.removable && entry.subscriptionId}>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          tone="danger"
                          label={t('prefs.notifications.remove', { name: entry.name })}
                          icon={<Icon name="icons/actions/delete" />}
                          onClick={() => void deleteNotificationFeed(entry.subscriptionId!)}
                        />
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Card>
          </Show>
        )}
      </For>

      <Card title={t('prefs.notifications.add-feed')} description={t('prefs.notifications.add-feed-description')}>
        <div data-vesta="prefs-add-feed">
          <TextField
            aria-label={t('prefs.notifications.feed-url')}
            placeholder="https://example.com/feed.xml"
            value={address()}
            onChange={setAddress}
          />
          <Button
            tone="accent"
            disabled={!validAddress()}
            icon={<Icon name="icons/actions/add" size={14} />}
            onClick={addFeed}
          >
            {t('prefs.notifications.subscribe')}
          </Button>
        </div>
      </Card>
    </>
  );
}
