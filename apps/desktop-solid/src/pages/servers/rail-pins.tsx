import { Metadata } from '../../components/metadata';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, Tooltip, mergeElementProps } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { initials, serverArt } from '../../features/servers/art';
import { lifecycleControls, minecraftFact, quickAction, statusDot } from '../../features/servers/model';
import { pinnedServers, serverIcon, updateServer } from '../../features/servers/store';
import { KillDialog } from './kill';
import { actionIcons, actionLabels, useLifecycle } from './lifecycle';
import { Icon } from '../../components/icon';
import './servers.css';

/** Status for the shared pin dot: green while ready, red when it needs attention, a crescent while asleep. */
const pinStatus = (dot: ReturnType<typeof statusDot>) => (dot === 'online' ? 'running' : dot === 'problem' ? 'crashed' : dot === 'sleeping' ? 'sleeping' : undefined);

/** Pinned servers, rendered inside the rail's pinned list with the same tile as pinned instances. */
export function RailServerPins() {
  return (
        <For each={pinnedServers()} keyed={(snapshot) => snapshot.connection.id}>
          {(snapshot) => {
            const href = () => `/servers/${snapshot().connection.id}`;
            const lifecycle = useLifecycle(snapshot);
            const [killing, setKilling] = createSignal(false, { name: 'rail-pin:killing' });
            const quick = () => quickAction(snapshot());
            const busy = () => !!lifecycle.busy() || lifecycleControls(snapshot()).progress !== null;
            const label = () => `${snapshot().connection.name}
${t(minecraftFact(snapshot().status).message)}`;
            return (
              <>
              <ContextMenu
                trigger={(contextProps) => (
                  <Tooltip
                    content={<Metadata parts={[snapshot().connection.name, t(minecraftFact(snapshot().status).message)]} />}
                    placement="right"
                    trigger={(triggerProps) => (
                      <a
                        {...mergeElementProps<Record<string, unknown>>(triggerProps, contextProps)}
                        data-vesta="rail-pin"
                        data-preload-server={snapshot().connection.id}
                        data-status={pinStatus(statusDot(snapshot()))}
                        href={`#${href()}`}
                        aria-label={label()}
                        aria-current={route().page === 'servers' && route().section === snapshot().connection.id ? 'page' : undefined}
                        onClick={(event) => { event.preventDefault(); transitionTo(href()); }}
                      >
                        <img
                          data-vesta="rail-pin-image"
                          src={serverIcon(snapshot().connection.id) ?? serverArt(snapshot().connection.serverId || snapshot().connection.id, initials(snapshot().connection.name))}
                          alt=""
                          draggable="false"
                        />
                      </a>
                    )}
                  />
                )}
              >
                {/* Same shape as a pinned instance: the main action, where to go, then the pin. */}
                <Show when={quick()}>
                  {(action) => <ContextMenuItem icon={<Icon name={actionIcons[action()]} />} disabled={busy()} onSelect={() => void lifecycle.submit(action())}>{t(actionLabels[action()])}</ContextMenuItem>}
                </Show>
                <Show when={lifecycleControls(snapshot()).stop}>
                  <ContextMenuItem icon={<Icon name="icons/actions/stop" />} disabled={busy()} onSelect={() => void lifecycle.submit('stop')}>{t('servers.lifecycle.stop')}</ContextMenuItem>
                </Show>
                <Show when={lifecycleControls(snapshot()).primary === 'kill'}>
                  <ContextMenuItem icon={<Icon name="icons/actions/stop" />} tone="danger" onSelect={() => setKilling(true)}>{t('servers.lifecycle.kill')}</ContextMenuItem>
                </Show>
                <ContextMenuItem icon={<Icon name="icons/rail/servers" />} onSelect={() => transitionTo(href())}>{t('servers.open')}</ContextMenuItem>
                <ContextMenuItem icon={<Icon name="icons/content/terminal" />} onSelect={() => transitionTo(`${href()}/console`)}>{t('servers.tab.console')}</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem icon={<Icon name="icons/actions/unpin" />} onSelect={() => void updateServer(snapshot().connection.id, { pinned: false })}>{t('common.unpin')}</ContextMenuItem>
              </ContextMenu>
              <KillDialog snapshot={snapshot()} open={killing()} onOpenChange={setKilling} />
              </>
            );
          }}
        </For>
  );
}
