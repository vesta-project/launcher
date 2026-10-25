import { Button, IconButton, Select } from '@vesta/ui';
import { For, Show, type Component } from 'solid-js';
import { Dynamic } from '@solidjs/web';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import { accessFact, connectionFact } from '../../features/servers/model';
import { paneState, settingsGroups, visibleSections, type SettingsSectionId } from '../../features/servers/shell-model';
import { serverRefreshing, useServersClock } from '../../features/servers/store';
import type { ServerSnapshot } from '../../features/servers/native';
import { refreshServerWithFeedback } from './refresh-button';
import { AccessTab } from './tabs/access-tab';
import { ConnectionTab } from './tabs/connection-tab';
import { PlayerManager } from './tabs/players-tab';
import { PresenceTab } from './tabs/presence-tab';
import { PropertiesTab } from './tabs/properties-tab';
import { ServerProfilePanel } from './tabs/server-profile';
import { SftpSection } from './hosting/sftp';
import { SoftwareSection } from './hosting/software-section';
import { WorldSection } from './hosting/world-section';
import '../library/instance/settings-tab.css';
import '../settings/settings-page.css';

const views: Record<SettingsSectionId, { view: Component<{ snapshot: ServerSnapshot }>; flush: boolean }> = {
  general: { view: ServerProfilePanel, flush: true },
  game: { view: PropertiesTab, flush: true },
  world: { view: WorldSection, flush: true },
  software: { view: SoftwareSection, flush: true },
  sftp: { view: SftpSection, flush: true },
  presence: { view: PresenceTab, flush: true },
  players: { view: PlayerManager, flush: true },
  access: { view: AccessTab, flush: true },
  connection: { view: ConnectionTab, flush: true },
};

/**
 * Settings mode, opened from the header gear: the section list replaces the tabs
 * ("‹ Back" + grouped sections, like the instance and launcher settings), and the pane
 * shows one section at a time.
 */
export function ServerSettings(props: {
  snapshot: ServerSnapshot;
  section: SettingsSectionId;
  onSection: (section: SettingsSectionId) => void;
  onBack: () => void;
}) {
  const sections = () => visibleSections(props.snapshot);
  const groups = () => settingsGroups
    .map((group) => ({ ...group, items: sections().filter((section) => section.group === group.id) }))
    .filter((group) => group.items.length > 0);
  const active = () => (sections().some((section) => section.id === props.section) ? props.section : sections()[0]?.id ?? 'connection');
  const current = () => sections().find((section) => section.id === active())!;

  return (
    <div data-vesta="instance-settings" data-server-settings>
      <nav data-vesta="instance-settings-nav" aria-label={t('servers.settings.sections')}>
        <Button size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-back" />} onClick={props.onBack}>
          {t('instance-settings.back')}
        </Button>
        <For each={groups()}>
          {(group) => (
            <div data-vesta="prefs-nav-group" role="group" aria-label={t(group.label)}>
              <span data-vesta="prefs-nav-heading">{t(group.label)}</span>
              <For each={group.items}>
                {(section) => (
                  <button
                    type="button"
                    data-vesta="prefs-nav-item"
                    data-server-prefetch={section.id}
                    data-offline={paneState(props.snapshot, section) === 'offline' ? '' : undefined}
                    aria-current={active() === section.id ? 'page' : undefined}
                    onClick={() => props.onSection(section.id)}
                  >
                    <Icon name={section.icon} size={16} />
                    {t(section.label)}
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </nav>

      <div data-vesta="settings-content">
        <div data-vesta="pane-toolbar" data-server-settings-narrow>
          <IconButton size="sm" variant="ghost" label={t('instance-settings.back')} icon={<Icon name="icons/navigation/arrow-back" />} onClick={props.onBack} />
          <Select
            size="sm"
            aria-label={t('servers.settings.sections')}
            value={active()}
            onChange={(value) => props.onSection(value as SettingsSectionId)}
            options={sections().map((section) => ({ value: section.id, label: t(section.label) }))}
          />
        </div>
        <Show when={active()} keyed>
          {(section) => (
            <div class={views[section].flush ? 'instance-pane instance-pane-flush' : 'instance-pane'}>
              <Show when={paneState(props.snapshot, current()) === 'ready'} fallback={<ServerOfflinePane snapshot={props.snapshot} />}>
                <Dynamic component={views[section].view} snapshot={props.snapshot} />
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

/**
 * The one calm placeholder a pane shows while the agent can't be reached. Overview keeps
 * the last known state; every pane that reads from the agent shows this instead of failing.
 */
export function ServerOfflinePane(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const id = () => props.snapshot.connection.id;
  const name = () => props.snapshot.connection.name;
  const online = () => props.snapshot.state.phase === 'online';
  const title = () => {
    if (online()) { const fact = accessFact(props.snapshot); return t(fact.message, fact.args); }
    return props.snapshot.state.phase === 'connecting' ? t('servers.offline.connecting-title', { name: name() }) : t('servers.offline.title', { name: name() });
  };
  const description = () => {
    if (online()) return undefined;
    const fact = connectionFact(props.snapshot, now());
    return fact.message === 'servers.connection.retrying'
      ? t('servers.offline.retrying', { count: fact.args?.count ?? 0 })
      : t('servers.offline.waiting');
  };
  return (
    <div data-vesta="server-offline-pane">
      <EmptyState icon="icons/status/connection-lost" title={title()} description={description()}>
        <Show when={!online()}>
          <Button size="sm" variant="outline" disabled={serverRefreshing(id())} onClick={() => void refreshServerWithFeedback(id())}>
            {t('servers.offline.retry')}
          </Button>
        </Show>
      </EmptyState>
    </div>
  );
}
