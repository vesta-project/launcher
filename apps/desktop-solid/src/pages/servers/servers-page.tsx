import { Button, IconButton } from '@vesta/ui';
import { For, Match, Show, Switch, createMemo } from 'solid-js';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { usingFixtures } from '../../features/servers/service';
import { refreshServers, serverSnapshots, serversListError, serversLoaded, useServersClock } from '../../features/servers/store';
import { AddServer } from './add-server';
import { HostGuide } from './onboarding';
import { FirstServerSetup } from './first-server';
import { addRoute } from '../../features/servers/onboarding-model';
import { groupServers, importPercent } from '../../features/servers/host-model';
import { activeImports, hosts } from '../../features/servers/hosts-store';
import type { ServerSnapshot } from '../../features/servers/native';
import { HostImport } from './host-import';
import { HostSettings } from './host-settings';
import { ServerCard } from './server-card';
import { ServerWorkspace } from './server-page';
import { ServerErrorNote } from './parts';
import { VestaSetup } from './vesta-setup';
import '../library/library-page.css';
import './servers.css';
import './vesta-server.css';

/**
 * `/servers`, `/servers/setup` (also the old `/servers/add`), `/servers/add/<guide or connectionId>`,
 * `/servers/host/<hostId>[/import]` and `/servers/<connectionId>[/<tab>]`.
 */
export function ServersPage() {
  const section = () => route().section;
  return (
    <Show when={section() !== 'setup' && section() !== 'add'} fallback={<AddPage />}>
      <Show when={section() === 'host' ? route().detail : undefined} keyed fallback={
        <Show when={section() !== 'host' ? section() : undefined} keyed fallback={<ServerList />}>
          {(id) => <ServerWorkspace id={id} />}
        </Show>
      }>
        {(hostId) => (
          <Show when={route().item === 'import'} fallback={<HostSettings hostId={hostId} />}>
            <HostImport hostId={hostId} />
          </Show>
        )}
      </Show>
    </Show>
  );
}

/**
 * `/servers/setup` and `/servers/add` start by setting up a Vesta Server. The older guides,
 * first-server setup and re-pairing a saved connection keep their `/servers/add/<detail>` routes.
 */
function AddPage() {
  const target = () => addRoute(route().section === 'setup' ? undefined : route().detail, route().item);
  return (
    <Switch>
      <Match when={target().kind === 'start'}><VestaSetup /></Match>
      <Match when={target().kind === 'connect'}><AddServer /></Match>
      <Match when={(() => { const value = target(); return value.kind === 'host' ? value.mode : undefined; })()} keyed>
        {(mode) => <HostGuide mode={mode} />}
      </Match>
      <Match when={(() => { const value = target(); return value.kind === 'setup' ? value.connectionId : undefined; })()} keyed>
        {(id) => <FirstServerSetup connectionId={id} />}
      </Match>
      <Match when={(() => { const value = target(); return value.kind === 'reconnect' ? value.connectionId : undefined; })()} keyed>
        {(id) => <AddServer connectionId={id} />}
      </Match>
    </Switch>
  );
}

/** The server grid, laid out exactly like the Library: cards, then an add tile. */
function ServerList() {
  const now = useServersClock();
  const groups = createMemo(() => groupServers(serverSnapshots(), hosts()), { name: 'servers:groups' });
  const single = () => (hosts().length === 1 ? hosts()[0] : undefined);
  return (
    <Board>
      <Show when={usingFixtures}>
        <p data-vesta="servers-preview-note">{t('servers.preview-note')}</p>
      </Show>
      <ServerErrorNote error={serversListError()} onRetry={() => void refreshServers()} />
      <For each={activeImports()}>
        {(task) => (
          <p data-vesta="server-callout" data-tone="neutral" class="vesta-import-banner">
            <span>{t('vesta-server.list.importing', { name: task.name, percent: Math.floor(importPercent(task.job?.progress) ?? 0) })}</span>
            <Button size="sm" onClick={() => transitionTo(`/servers/host/${task.hostId}/import`)}>{t('vesta-server.host.import-open')}</Button>
          </p>
        )}
      </For>
      <Show when={hosts().length > 0}>
        <div data-vesta="vesta-machine-bar">
          <Show when={single()}>
            {(host) => <Button size="sm" variant="ghost" icon={<Icon name="icons/content/server" />} onClick={() => transitionTo(`/servers/host/${host().id}`)}>{host().name}</Button>}
          </Show>
          <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/add" />} onClick={() => transitionTo('/servers/setup')}>{t('vesta-server.setup.title')}</Button>
        </div>
      </Show>
      <Show
        when={serverSnapshots().length > 0 || hosts().length > 1}
        fallback={
          <Show when={serversLoaded()}>
            <EmptyState icon="icons/rail/servers" title={t('servers.empty-title')} description={t('vesta-server.list.empty-description')}>
              <Show when={single()} fallback={
                <Button tone="accent" icon={<Icon name="icons/actions/add" />} onClick={() => transitionTo('/servers/setup')}>{t('vesta-server.setup.title')}</Button>
              }>
                {(host) => <Button tone="accent" icon={<Icon name="icons/actions/add" />} onClick={() => transitionTo(`/servers/host/${host().id}/import`)}>{t('vesta-server.host.add-server')}</Button>}
              </Show>
            </EmptyState>
          </Show>
        }
      >
        <For each={groups()} keyed={(group) => group.key}>
          {(group) => (
            <section data-vesta="vesta-server-group" aria-label={group().host?.name ?? (group().key === 'other' ? t('vesta-server.list.other') : t('servers.title'))}>
              <Show when={group().host}>
                {(host) => (
                  <header data-vesta="vesta-group-header">
                    <h2><Icon name="icons/content/server" size={16} />{host().name}</h2>
                    <IconButton size="sm" variant="ghost" label={t('vesta-server.list.settings', { name: host().name })} icon={<Icon name="icons/content/gear" />}
                      onClick={() => transitionTo(`/servers/host/${host().id}`)} />
                  </header>
                )}
              </Show>
              <Show when={group().key === 'other'}>
                <header data-vesta="vesta-group-header"><h2>{t('vesta-server.list.other')}</h2></header>
              </Show>
              <ServerGrid servers={group().servers} now={now()} label={group().host?.name ?? t('servers.title')}
                addTo={group().host?.id ?? (group().key === 'all' ? single()?.id ?? null : undefined)} />
            </section>
          )}
        </For>
      </Show>
    </Board>
  );
}

/** Cards, then one add tile: add a server to this machine, or set up a new machine. */
function ServerGrid(props: { servers: ServerSnapshot[]; now: number; label: string; addTo: string | null | undefined }) {
  return (
    <ul data-vesta="library-grid" aria-label={props.label}>
      <For each={props.servers} keyed={(snapshot) => snapshot.connection.id}>
        {(snapshot) => (
          <li>
            <div data-vesta="library-card-slot">
              <ServerCard snapshot={snapshot()} now={props.now} />
            </div>
          </li>
        )}
      </For>
      <Show when={props.addTo !== undefined}>
        <li>
          <div data-vesta="library-card-slot">
            <button type="button" data-vesta="server-add-tile" onClick={() => transitionTo(props.addTo ? `/servers/host/${props.addTo}/import` : '/servers/setup')}>
              <Icon name="icons/actions/add" size={22} />
              <span>{props.addTo ? t('vesta-server.host.add-server') : t('vesta-server.setup.title')}</span>
            </button>
          </div>
        </li>
      </Show>
    </ul>
  );
}
