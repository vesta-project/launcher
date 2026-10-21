import { ContextMenu, ContextMenuItem, ContextMenuSeparator, Tooltip, mergeElementProps } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { minecraftFact, statusDot } from '../../features/servers/model';
import { pinnedServers, updateServer } from '../../features/servers/store';
import { StatusDot } from './parts';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('') || '?';

/** Pinned servers below pinned instances: initials tile with a status dot. */
export function RailServerPins() {
  return (
    <Show when={pinnedServers().length > 0}>
      <div data-vesta="rail-divider" />
      <div data-vesta="rail-pinned">
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
                        data-vesta="rail-server-pin"
                        href={`#${href()}`}
                        aria-label={label()}
                        aria-current={route().page === 'servers' && route().section === snapshot().connection.id ? 'page' : undefined}
                        onClick={(event) => { event.preventDefault(); transitionTo(href()); }}
                      >
                        <span data-vesta="rail-server-initials">{initials(snapshot().connection.name)}</span>
                        <StatusDot dot={statusDot(snapshot())} />
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
      </div>
    </Show>
  );
}
