import { For, Match, Show, Switch } from 'solid-js';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { usingFixtures } from '../../features/servers/service';
import { refreshServers, serverSnapshots, serversListError, serversLoaded, useServersClock } from '../../features/servers/store';
import { AddServer } from './add-server';
import { HostGuide, ServerStart, serverStartChoices } from './onboarding';
import { FirstServerSetup } from './first-server';
import { addRoute } from '../../features/servers/onboarding-model';
import { ServerCard } from './server-card';
import { ServerWorkspace } from './server-page';
import { ServerErrorNote } from './parts';
import '../library/library-page.css';
import './servers.css';

/** `/servers`, `/servers/add`, `/servers/<connectionId>[/<tab>]`. */
export function ServersPage() {
  return (
    <Show
      when={route().section === 'add'}
      fallback={
        <Show when={route().section} keyed fallback={<ServerList />}>
          {(id) => <ServerWorkspace id={id} />}
        </Show>
      }
    >
      <AddPage />
    </Show>
  );
}

/** `/servers/add` and its guides; a saved connection id re-pairs that server. */
function AddPage() {
  const target = () => addRoute(route().detail, route().item);
  return (
    <Switch>
      <Match when={target().kind === 'start'}><ServerStart /></Match>
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
  return (
    <Board>
      <Show when={usingFixtures}>
        <p data-vesta="servers-preview-note">{t('servers.preview-note')}</p>
      </Show>
      <ServerErrorNote error={serversListError()} onRetry={() => void refreshServers()} />
      <Show
        when={serverSnapshots().length > 0}
        fallback={
          <Show when={serversLoaded()}>
            <EmptyState icon="icons/rail/servers" title={t('servers.empty-title')} description={t('servers.empty-description')}
              suggestionsLabel={t('servers.start.label')} suggestions={serverStartChoices()} />
          </Show>
        }
      >
        <ul data-vesta="library-grid" aria-label={t('servers.title')}>
          <For each={serverSnapshots()} keyed={(snapshot) => snapshot.connection.id}>
            {(snapshot) => (
              <li>
                <div data-vesta="library-card-slot">
                  <ServerCard snapshot={snapshot()} now={now()} />
                </div>
              </li>
            )}
          </For>
          <li>
            <div data-vesta="library-card-slot">
              <button type="button" data-vesta="server-add-tile" onClick={() => transitionTo('/servers/add')}>
                <Icon name="icons/actions/add" size={22} />
                <span>{t('servers.add')}</span>
              </button>
            </div>
          </li>
        </ul>
      </Show>
    </Board>
  );
}
