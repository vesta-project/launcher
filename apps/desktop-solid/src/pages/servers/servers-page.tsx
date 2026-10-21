import { Button, IconButton } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { accessFact, connectionFact, minecraftFact, playersFact, statusDot } from '../../features/servers/model';
import { usingFixtures } from '../../features/servers/service';
import { refreshServers, serverSnapshots, serversListError, serversLoaded, updateServer, useServersClock } from '../../features/servers/store';
import type { ServerSnapshot } from '../../features/servers/native';
import { AddServer } from './add-server';
import { ServerWorkspace } from './server-page';
import { FactBadge, ServerErrorNote, StatusDot } from './parts';
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
      <AddServer />
    </Show>
  );
}

function ServerList() {
  const now = useServersClock();
  return (
    <Board class="servers-board">
      <div data-vesta="servers-list-page">
        <header data-vesta="servers-list-header">
          <div>
            <h1>{t('servers.title')}</h1>
            <p>{t('servers.subtitle')}</p>
          </div>
          <Show when={serverSnapshots().length > 0}>
            <Button icon={<Icon name="icons/actions/add" />} onClick={() => transitionTo('/servers/add')}>{t('servers.add')}</Button>
          </Show>
        </header>
        <Show when={usingFixtures}>
          <p data-vesta="servers-preview-note">{t('servers.preview-note')}</p>
        </Show>
        <ServerErrorNote error={serversListError()} onRetry={() => void refreshServers()} />
        <Show
          when={serverSnapshots().length > 0}
          fallback={
            <Show when={serversLoaded()}>
              <EmptyState icon="icons/rail/servers" title={t('servers.empty-title')} description={t('servers.empty-description')}>
                <Button icon={<Icon name="icons/actions/add" />} onClick={() => transitionTo('/servers/add')}>{t('servers.add')}</Button>
              </EmptyState>
            </Show>
          }
        >
          <ul data-vesta="servers-grid">
            <For each={serverSnapshots()} keyed={(snapshot) => snapshot.connection.id}>
              {(snapshot) => <ServerCard snapshot={snapshot()} now={now()} />}
            </For>
          </ul>
        </Show>
      </div>
    </Board>
  );
}

function ServerCard(props: { snapshot: ServerSnapshot; now: number }) {
  const href = () => `/servers/${props.snapshot.connection.id}`;
  const open = () => transitionTo(href());
  return (
    <li data-vesta="server-card" data-dot={statusDot(props.snapshot)}>
      <a data-vesta="server-card-link" href={`#${href()}`} onClick={(event) => { event.preventDefault(); open(); }}>
        <span data-vesta="server-card-icon"><Icon name="icons/rail/servers" size={22} /><StatusDot dot={statusDot(props.snapshot)} /></span>
        <span data-vesta="server-card-title">
          <strong>{props.snapshot.connection.name}</strong>
          <span>{props.snapshot.connection.endpoint}</span>
        </span>
      </a>
      <IconButton
        variant="ghost"
        size="sm"
        icon={<Icon name={props.snapshot.connection.pinned ? 'icons/actions/unpin' : 'icons/actions/pin'} />}
        label={props.snapshot.connection.pinned ? t('common.unpin') : t('servers.pin')}
        onClick={() => void updateServer(props.snapshot.connection.id, { pinned: !props.snapshot.connection.pinned })}
      />
      <div data-vesta="server-card-facts">
        <FactBadge fact={minecraftFact(props.snapshot.status)} />
        <Show when={props.snapshot.status && props.snapshot.status.state !== 'stopped'}>
          <FactBadge fact={playersFact(props.snapshot.status, props.now)} />
        </Show>
      </div>
      <div data-vesta="server-card-meta">
        <span>{t(connectionFact(props.snapshot, props.now).message, connectionFact(props.snapshot, props.now).args)}</span>
        <span>{t(accessFact(props.snapshot).message, accessFact(props.snapshot).args)}</span>
      </div>
    </li>
  );
}
