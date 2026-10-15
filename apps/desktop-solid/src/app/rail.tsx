import { Tooltip } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { Icon } from '../components/icon';
import { AccountMenu } from '../features/accounts/account-menu';
import { pinnedInstances } from '../features/instances/fixtures';
import { navigate, route } from './router';
import { mainNav, settingsNav, type NavItem } from './routes';
import './rail.css';

function RailLink(props: { item: NavItem }) {
  return (
    <Tooltip
      content={props.item.label}
      placement="right"
      trigger={(triggerProps) => (
        <a
          {...triggerProps}
          data-vesta="rail-button"
          href={`#${props.item.href}`}
          aria-label={props.item.label}
          aria-current={route().page === props.item.id ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate(props.item.href);
          }}
        >
          <Icon name={props.item.icon} size={22} />
        </a>
      )}
    />
  );
}

/** Persistent navigation: account, destinations, pinned instances, settings. */
export function Rail() {
  const move = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('a[data-vesta^=rail]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };

  return (
    <aside data-vesta="rail" aria-label="Primary navigation" onKeyDown={move}>
      <div data-vesta="rail-top">
        <div data-vesta="rail-account">
          <AccountMenu placement="right-start" onManage={() => navigate('/settings/account')} />
        </div>

        <nav data-vesta="rail-nav" aria-label="Launcher">
          <For each={mainNav}>{(item) => <RailLink item={item} />}</For>
        </nav>

        <Show when={pinnedInstances().length > 0}>
          <div data-vesta="rail-divider" />
          <div data-vesta="rail-pinned">
            <For each={pinnedInstances()} keyed={(entry) => entry.instance.id}>
              {(entry) => (
                <Tooltip
                  content={`Pinned: ${entry().instance.name}`}
                  placement="right"
                  trigger={(triggerProps) => (
                    <a
                      {...triggerProps}
                      data-vesta="rail-pin"
                      href={`#/library/${entry().instance.id}`}
                      aria-label={`Open ${entry().instance.name}`}
                      aria-current={route().page === 'library' && route().section === entry().instance.id ? 'page' : undefined}
                      style={{ '--pin-image': `url('${entry().instance.image}')` } as never}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/library/${entry().instance.id}`);
                      }}
                    />
                  )}
                />
              )}
            </For>
          </div>
        </Show>
      </div>

      <div data-vesta="rail-bottom">
        <RailLink item={settingsNav} />
      </div>
    </aside>
  );
}
