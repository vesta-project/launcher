import { ModpackTab } from './pack/modpack-tab';
import { Button, Tab, TabList, TabPanel, Tabs } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack, type Component } from 'solid-js';
import { Dynamic, isServer } from '@solidjs/web';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { canGoBack, route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { anyVisible, gate } from '../../features/servers/capabilities';
import { stableConnectionId } from '../../features/servers/connection-id';
import { invalidateServerResources, useServerResource } from '../../features/servers/resources';
import { backupsResource, operationsResource } from '../../features/servers/server-resources';
import {
  activeNavEntry, agentReachable, backupsConfigured, navEntryPath, paneState, resolveServerLocation, serverNavEntries, serverPath, visibleMainTabs,
  visibleSections, type MainTabId, type ServerNavEntry, type SettingsSectionId,
} from '../../features/servers/shell-model';
import { putSnapshot, removeServer, serverCommand, serverSnapshot, serversLoaded, useServerTopic } from '../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../features/servers/native';
import { ActivityTab } from './tabs/activity-tab';
import { AutomationTab } from './tabs/automation-tab';
import { BackupsTab } from './tabs/backups-tab';
import { ConsoleTab } from './tabs/console-tab';
import { FilesTab } from './tabs/files-tab';
import { OverviewTab } from './tabs/overview-tab';
import { ServerResourcesTab } from './tabs/resources-tab';
import { prefetchServerTarget, useServerNavPrefetch } from './nav-prefetch';
import { FingerprintView, ServerErrorNote } from './parts';
import { ServerHeader } from './server-header';
import { ServerOfflinePane, ServerSettings } from './server-settings';
import { ServerShellContext } from './shell-context';
import '../library/instance/instance-header.css';
import '../library/instance/instance-page.css';

const views: Record<MainTabId, { view: Component<{ snapshot: ServerSnapshot }>; flush: boolean }> = {
  overview: { view: OverviewTab, flush: false },
  console: { view: ConsoleTab, flush: true },
  resources: { view: ServerResourcesTab, flush: true },
  pack: { view: ModpackTab, flush: true },
  files: { view: FilesTab, flush: true },
  automation: { view: AutomationTab, flush: true },
  backups: { view: BackupsTab, flush: true },
  activity: { view: ActivityTab, flush: true },
};

/** A sidebar row: an entry, or the heading that starts a group. */
type NavItem = { key: string; entry: ServerNavEntry; heading?: undefined } | { key: string; heading: MessageId; entry?: undefined };

const sideNavQuery = '(min-width: 960px)';
function useSideNav() {
  if (isServer) return () => false;
  const media = matchMedia(sideNavQuery);
  const [wide, setWide] = createSignal(media.matches, { name: 'servers:side-nav' });
  const change = () => setWide(media.matches);
  media.addEventListener('change', change);
  onCleanup(() => media.removeEventListener('change', change));
  return wide;
}

export function ServerWorkspace(props: { id: string }) {
  return (
    <Show
      when={serverSnapshot(props.id)}
      fallback={
        <Board>
          <Show when={serversLoaded()}>
            <EmptyState icon="icons/rail/servers" title={t('servers.not-found')}>
              <Button onClick={() => transitionTo('/servers')}>{t('servers.done.all-servers')}</Button>
            </EmptyState>
          </Show>
        </Board>
      }
    >
      <ServerContent id={props.id} />
    </Show>
  );
}

/**
 * The server workspace, laid out like an instance: header, a short list of main tabs,
 * and a settings mode (from the header gear) whose section list replaces the tabs.
 */
function ServerContent(props: { id: string }) {
  // One status subscription per open workspace; native code shares the stream.
  useServerTopic(() => props.id, 'status');
  useServerTopic(() => props.id, 'operations');
  const sideNav = useSideNav();
  const snapshot = () => serverSnapshot(props.id)!;
  const id = stableConnectionId(snapshot);
  const reachable = createMemo(() => agentReachable(snapshot()), { name: 'server-workspace:reachable' });
  const location = createMemo(() => resolveServerLocation(route().detail, route().item), { name: 'server-workspace:location' });
  const [previousTab, setPreviousTab] = createSignal<MainTabId>('overview', { name: 'server-workspace:previous-tab' });
  let layout: HTMLDivElement | undefined;

  // Backups only get a tab when the server has a profile; learn that once per connection, in the background.
  const backupsFlag = () => typeof (snapshot() as ServerSnapshot & { backupsConfigured?: unknown }).backupsConfigured === 'boolean';
  // Recent tasks, once per connection (the operations topic keeps them current); console and overview read them.
  useServerResource(id, operationsResource, { enabled: () => reachable() && anyVisible(snapshot().capabilities, ['tasks.view']) });
  const backups = useServerResource(id, backupsResource, {
    enabled: () => reachable() && gate(snapshot().capabilities, 'backups.view') !== 'denied' && !backupsFlag(),
  });
  const tabs = () => visibleMainTabs({ snapshot: snapshot(), backupsConfigured: backupsConfigured(snapshot(), backups.value()), requested: route().detail });
  const activeTab = (): MainTabId => {
    const current = location();
    return current.mode === 'main' && tabs().some((tab) => tab.id === current.tab) ? current.tab : 'overview';
  };
  // Pack editors get Server modpack and Client pack as two entries under a "Modpack" group.
  const editsPack = () => gate(snapshot().capabilities, 'pack.edit') === 'allowed';
  const entries = () => serverNavEntries(tabs(), editsPack());
  const navItems = (): NavItem[] => entries().flatMap((entry, index, all): NavItem[] => (entry.group && all[index - 1]?.group !== entry.group
    ? [{ key: `group:${entry.group}`, heading: 'server-pack.title' }, { key: entry.value, entry }]
    : [{ key: entry.value, entry }]));
  const activeEntry = () => activeNavEntry(activeTab(), route().item, editsPack());
  const settings = () => location().mode === 'settings';
  const section = (): SettingsSectionId => {
    const current = location();
    return current.mode === 'settings' && visibleSections(snapshot()).some((entry) => entry.id === current.section)
      ? current.section : visibleSections(snapshot())[0]?.id ?? 'connection';
  };

  // A new Minecraft run makes run-bound data stale; shown data stays while it revalidates.
  let lastGeneration: string | null | undefined;
  createEffect(() => snapshot().status?.generation ?? null, (generation) => {
    if (lastGeneration !== undefined && generation !== lastGeneration) invalidateServerResources(props.id);
    lastGeneration = generation;
  }, { name: 'server-workspace:generation' });

  // Warm the landing tab once the agent answers.
  createEffect(reachable, (online) => { if (online) prefetchServerTarget(untrack(snapshot), untrack(activeTab)); }, { name: 'server-workspace:warm' });
  useServerNavPrefetch(() => layout, snapshot);

  const open = (tab: MainTabId) => {
    setPreviousTab(tab);
    transitionTo(serverPath(props.id, { mode: 'main', tab }));
  };
  const openEntry = (value: string) => {
    const entry = entries().find((candidate) => candidate.value === value);
    if (!entry) return;
    setPreviousTab(entry.tab.id);
    transitionTo(navEntryPath(props.id, value));
  };
  const openSettings = () => {
    if (settings()) return;
    setPreviousTab(activeTab());
    transitionTo(serverPath(props.id, { mode: 'settings', section: visibleSections(snapshot())[0]?.id ?? 'connection' }));
  };
  // Sections are sibling views: switching replaces the entry, so Back leaves settings.
  const openSection = (next: SettingsSectionId) => transitionTo(serverPath(props.id, { mode: 'settings', section: next }), undefined, { replace: true });
  const back = () => (canGoBack() ? history.back() : open(previousTab()));
  const blocked = () => snapshot().state.access === 'fingerprint_changed' || snapshot().state.access === 'credentials_rejected';

  return (
    <ServerShellContext value={{ snapshot, openSection }}>
      <Board fixed class="instance-board servers-workspace">
        <div data-vesta="instance-layout" ref={(element) => { layout = element; }}>
          <ServerHeader snapshot={snapshot()} compact={settings()} onOpenSettings={openSettings} />
          <Show when={activeTab() !== 'backups' && reachable()}>
            <ServerErrorNote error={backups.error()} onRetry={() => void backups.refresh()} />
          </Show>
          <Show
            when={!blocked()}
            fallback={
              <div class="instance-pane">
                <Show when={snapshot().state.access === 'fingerprint_changed'} fallback={<CredentialsRejected snapshot={snapshot()} />}>
                  <TrustChanged snapshot={snapshot()} />
                </Show>
              </div>
            }
          >
            <Show
              when={settings()}
              fallback={
                <Tabs size="sm" orientation={sideNav() ? 'vertical' : 'horizontal'} value={activeEntry()} onChange={openEntry} class="instance-tabs">
                  <TabList aria-label={t('servers.sections')}>
                    <For each={navItems()} keyed={(item) => item.key}>
                      {(item) => (
                        <Show when={item().entry} fallback={<span data-vesta="server-nav-heading" aria-hidden="true">{t(item().heading!)}</span>}>
                          {(entry) => (
                            <Tab value={entry().value} icon={<Icon name={entry().icon} />} class={paneState(snapshot(), entry().tab) === 'offline' ? 'server-tab-offline' : undefined}>
                              <span data-server-prefetch={entry().tab.id}>{t(entry().label)}</span>
                            </Tab>
                          )}
                        </Show>
                      )}
                    </For>
                  </TabList>
                  <For each={entries()} keyed={(entry) => entry.value}>
                    {(entry) => (
                      <Show when={activeEntry() === entry().value}>
                        <TabPanel forceMount value={entry().value} class={views[entry().tab.id].flush ? 'instance-pane instance-pane-flush' : 'instance-pane'}>
                          <Show when={paneState(snapshot(), entry().tab) === 'ready'} fallback={<ServerOfflinePane snapshot={snapshot()} />}>
                            <Dynamic component={views[entry().tab.id].view} snapshot={snapshot()} />
                          </Show>
                        </TabPanel>
                      </Show>
                    )}
                  </For>
                </Tabs>
              }
            >
              <ServerSettings snapshot={snapshot()} section={section()} onSection={openSection} onBack={back} />
            </Show>
          </Show>
        </div>
      </Board>
    </ServerShellContext>
  );
}

/** Management pauses until the user compares the new fingerprint. */
function TrustChanged(props: { snapshot: ServerSnapshot }) {
  const [presented, setPresented] = createSignal<string | null>(null);
  const [error, setError] = createSignal<ServerCommandError | null>(null);
  const check = async () => {
    setError(null);
    try {
      const found = await serverCommand((client) => client.discover(props.snapshot.connection.endpoint));
      setPresented(found.fingerprint);
    } catch (reason) { setError(reason as ServerCommandError); }
  };
  const approve = async () => {
    const value = presented();
    if (!value) return;
    try { putSnapshot(await serverCommand((client) => client.approveFingerprint(props.snapshot.connection.id, value))); }
    catch (reason) { setError(reason as ServerCommandError); }
  };
  return (
    <div data-vesta="server-blocking" role="alert">
      <Icon name="icons/security/shield-off" size={28} />
      <h2>{t('servers.trust.changed-title')}</h2>
      <p>{t('servers.trust.changed-description')}</p>
      <h3>{t('servers.trust.approved')}</h3>
      <FingerprintView value={props.snapshot.connection.fingerprint} />
      <Show when={presented()}>
        {(value) => (<><h3>{t('servers.trust.presented')}</h3><FingerprintView value={value()} /></>)}
      </Show>
      <ServerErrorNote error={error()} />
      <footer>
        <Button variant="ghost" onClick={() => void removeServer(props.snapshot.connection.id).then(() => transitionTo('/servers'))}>{t('servers.remove')}</Button>
        <Show when={presented()} fallback={<Button onClick={() => void check()}>{t('servers.trust.check')}</Button>}>
          <Button tone="danger" onClick={() => void approve()}>{t('servers.trust.approve')}</Button>
        </Show>
      </footer>
    </div>
  );
}

function CredentialsRejected(props: { snapshot: ServerSnapshot }) {
  return (
    <div data-vesta="server-blocking" role="alert">
      <Icon name="icons/security/lock" size={28} />
      <h2>{t('servers.rejected.title')}</h2>
      <p>{t('servers.error.credentials-rejected')}</p>
      <footer>
        <Button variant="ghost" onClick={() => void removeServer(props.snapshot.connection.id).then(() => transitionTo('/servers'))}>{t('servers.remove')}</Button>
        <Button onClick={() => transitionTo('/servers/add')}>{t('servers.rejected.pair-again')}</Button>
      </footer>
    </div>
  );
}
