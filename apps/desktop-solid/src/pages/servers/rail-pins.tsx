import { ContextMenu, ContextMenuItem, ContextMenuSeparator, Tooltip, mergeElementProps } from '@vesta/ui';
import { For } from 'solid-js';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { initials, serverArt } from '../../features/servers/art';
import { minecraftFact, statusDot } from '../../features/servers/model';
import { pinnedServers, updateServer } from '../../features/servers/store';

/** Status for the shared pin dot: green while ready, red when it needs attention. */
const pinStatus = (dot: ReturnType<typeof statusDot>) => (dot === 'online' ? 'running' : dot === 'problem' ? 'crashed' : undefined);

/** Pinned servers, rendered inside the rail's pinned list with the same tile as pinned instances. */
export function RailServerPins() {
  return (
        <For each={pinnedServers()} keyed={(snapshot) => snapshot.connection.id}>
          {(snapshot) => {
            const href = () => `/servers/${snapshot().connection.id}`;
            const label = () => `${snapshot().connection.name} · ${t(minecraftFact(snapshot().status).message)}`;
            return (
              <ContextMenu
                trigger={(contextProps) => (
                  <Tooltip
                    content={label()}
                    placement="right"
                    trigger={(triggerProps) => (
                      <a
                        {...mergeElementProps<Record<string, unknown>>(triggerProps, contextProps)}
                        data-vesta="rail-pin"
                        data-status={pinStatus(statusDot(snapshot()))}
                        href={`#${href()}`}
                        aria-label={label()}
                        aria-current={route().page === 'servers' && route().section === snapshot().connection.id ? 'page' : undefined}
                        onClick={(event) => { event.preventDefault(); transitionTo(href()); }}
                      >
                        <img
                          data-vesta="rail-pin-image"
                          src={serverArt(snapshot().connection.serverId || snapshot().connection.id, initials(snapshot().connection.name))}
                          alt=""
                          draggable="false"
                        />
                      </a>
                    )}
                  />
                )}
              >
                <ContextMenuItem onSelect={() => transitionTo(href())}>{t('servers.open')}</ContextMenuItem>
                <ContextMenuItem onSelect={() => transitionTo(`${href()}/console`)}>{t('servers.tab.console')}</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => void updateServer(snapshot().connection.id, { pinned: false })}>{t('common.unpin')}</ContextMenuItem>
              </ContextMenu>
            );
          }}
        </For>
  );
}
