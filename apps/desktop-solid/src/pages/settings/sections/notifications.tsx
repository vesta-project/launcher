import { Button, IconButton, Switch, TextField } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { setting, updateSetting } from '../../../features/settings/config';
import { notificationFeeds, availableNotificationFeeds, notificationsCheckedAt, notificationsChecking, notificationError, checkNotificationsNow, toggleNotificationFeed, deleteNotificationFeed, subscribeToPreset, subscribeToRss } from '../../../features/settings/notifications';
import { t } from '../../../localization';
import { Card, ToggleRow } from '../parts';
import './notifications.css';

/** Native subscriptions, with an isolated browser preview. */
export function NotificationsSettings() {
  const feeds = notificationFeeds;
  const available = availableNotificationFeeds;
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
      <Show when={notificationError()}><p role="alert">{notificationError()}</p></Show>
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
        <Show when={feeds().length} fallback={<p data-vesta="prefs-empty-line">{t('prefs.notifications.none')}</p>}>
          <ul data-vesta="prefs-feeds">
            <For each={feeds()}>
              {(feed) => (
                <li>
                  <span data-vesta="prefs-feed-icon">
                    <Icon name={feed.custom ? 'icons/content/link' : 'icons/status/bell'} size={16} />
                  </span>
                  <div>
                    <strong>{feed.name}</strong>
                    <span>{feed.detail}</span>
                  </div>
                  <Switch
                    size="sm"
                    aria-label={feed.name}
                    checked={feed.enabled}
                    onChange={(on) =>
                      void toggleNotificationFeed(feed.id, on)
                    }
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    tone="danger"
                    label={t('prefs.notifications.remove', { name: feed.name })}
                    icon={<Icon name="icons/actions/delete" />}
                    onClick={() => void deleteNotificationFeed(feed.id)}
                  />
                </li>
              )}
            </For>
          </ul>
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

      <Show when={available().length}>
        <Card title={t('prefs.notifications.available')}>
          <ul data-vesta="prefs-feeds">
            <For each={available()}>
              {(preset) => (
                <li>
                  <span data-vesta="prefs-feed-icon">
                    <Icon name="icons/status/bell" size={16} />
                  </span>
                  <div>
                    <strong>{preset.name}</strong>
                    <span>{preset.detail}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void subscribeToPreset(preset.id)}
                  >
                    {t('prefs.notifications.subscribe')}
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Card>
      </Show>

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
