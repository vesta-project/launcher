import { requestCreateAction } from '../pages/create/install-navigation';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, Tooltip, mergeElementProps } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { setType } from '../features/browse/browse-store';
import { nativeInstances, openNativeInstanceFolder } from '../features/instances/native-service';
import { beginLibraryArrange } from '../features/instances/library-layout';
import { instances } from '../features/instances/catalog';
import { Icon } from '../components/icon';
import { AccountMenu } from '../features/accounts/account-menu';
import { movePin, pinnedInstances, playInstance, retryInstance, togglePin } from '../features/instances/catalog';
import { route } from './router';
import { transitionTo } from './transition';
import { mainNav, settingsNav, type NavItem } from './routes';
import { t } from '../localization';
import './rail.css';

function RailLink(props: { item: NavItem }) {
  return (
    <ContextMenu trigger={(contextProps) => <Tooltip
      content={t(props.item.label)}
      placement="right"
      trigger={(triggerProps) => (
        <a
          {...mergeElementProps<Record<string, unknown>>(triggerProps, contextProps)}
          data-vesta="rail-button"
          href={`#${props.item.href}`}
          aria-label={t(props.item.label)}
          aria-current={
            route().page === props.item.id && !(props.item.id === 'library' && route().section) ? 'page' : undefined
          }
          onClick={(event) => {
            event.preventDefault();
            transitionTo(props.item.href);
          }}
        >
          <Icon name={props.item.icon} size={22} />
        </a>
      )}
    />}>
      <Show when={props.item.id !== 'create'}>
        <ContextMenuItem onSelect={() => transitionTo(props.item.href)}>{t(props.item.label)}</ContextMenuItem>
        <ContextMenuSeparator />
      </Show>
      <Show when={props.item.id === 'library'}>
        <ContextMenuItem onSelect={() => transitionTo('/create')}>{t('nav.create')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => { transitionTo('/library'); beginLibraryArrange(instances().map((entry) => entry.instance.id)); }}>{t('library.arrange')}</ContextMenuItem>
      </Show>
      <Show when={props.item.id === 'create'}>
        <ContextMenuItem onSelect={() => requestCreateAction('new')}>{t('create-menu.new')}</ContextMenuItem>
        <ContextMenuItem disabled={!nativeInstances} onSelect={() => requestCreateAction('file')}>{t('create-menu.file')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => { setType('modpack'); transitionTo('/browse'); }}>{t('create-menu.packs')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => requestCreateAction('launchers')}>{t('create-menu.launcher')}</ContextMenuItem>
      </Show>
      <Show when={props.item.id === 'browse'}>
        <For each={['mod', 'modpack', 'resourcepack', 'shader', 'datapack', 'world'] as const}>
          {(kind) => <ContextMenuItem onSelect={() => { setType(kind); transitionTo('/browse'); }}>{t(`browse.kind-${kind}`)}</ContextMenuItem>}
        </For>
      </Show>
      <Show when={props.item.id === 'settings'}>
        <ContextMenuItem onSelect={() => transitionTo('/settings/appearance')}>{t('prefs.appearance.title')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => transitionTo('/settings/defaults')}>{t('prefs.defaults.title')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => transitionTo('/settings/about')}>{t('prefs.about.title')}</ContextMenuItem>
      </Show>
    </ContextMenu>
  );
}

/** Pin state for the tooltip and accessible name. Pins show no visible text; running and crashed use the instance status copy. */
function pinStatus(kind: string): string | undefined {
  if (kind === 'running') return t('instance.running');
  if (kind === 'crashed') return t('instance.crashed');
  return undefined;
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
    <aside data-vesta="rail" aria-label={t('nav.primary')} onKeyDown={move}>
      <div data-vesta="rail-top">
        <div data-vesta="rail-account">
          <AccountMenu placement="right-start" onManage={() => transitionTo('/settings/account')} />
        </div>

        <nav data-vesta="rail-nav" aria-label={t('nav.launcher')}>
          <For each={mainNav}>{(item) => <RailLink item={item} />}</For>
        </nav>

        <Show when={pinnedInstances().length > 0}>
          <div data-vesta="rail-divider" />
          <div data-vesta="rail-pinned">
            <For each={pinnedInstances()} keyed={(entry) => entry.instance.id}>
              {(entry, index) => (
                <ContextMenu
                  trigger={(contextProps) => (
                    <Tooltip
                      content={`${entry().instance.name} · ${pinStatus(entry().state.kind) ?? entry().instance.minecraftVersion}`}
                      placement="right"
                      trigger={(triggerProps) => (
                        <a
                          {...mergeElementProps<Record<string, unknown>>(triggerProps, contextProps)}
                          data-vesta="rail-pin"
                          data-status={entry().state.kind}
                          href={`#/library/${entry().instance.id}`}
                          aria-label={[t('common.open-instance', { name: entry().instance.name }), pinStatus(entry().state.kind)].filter(Boolean).join(', ')}
                          aria-current={
                            route().page === 'library' && route().section === entry().instance.id ? 'page' : undefined
                          }
                          onClick={(event) => {
                            event.preventDefault();
                            if (route().page === 'library' && route().section === entry().instance.id) return;
                            transitionTo(`/library/${entry().instance.id}`);
                          }}
                        >
                          <img data-vesta="rail-pin-image" src={entry().instance.image} alt="" draggable="false" />
                        </a>
                      )}
                    />
                  )}
                >
                  <ContextMenuItem
                    disabled={['warming', 'installing'].includes(entry().state.kind)}
                    onSelect={() => {
                      const kind = entry().state.kind;
                      if (['interrupted', 'failed'].includes(kind)) retryInstance(entry().instance.id, 'Resuming');
                      else playInstance(entry().instance.id);
                    }}
                  >
                    {entry().state.kind === 'running'
                      ? t('common.stop')
                      : ['interrupted', 'failed'].includes(entry().state.kind)
                        ? t('common.resume-installation')
                        : t('common.play')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => transitionTo(`/library/${entry().instance.id}`)}>{t('instance-actions.details')}</ContextMenuItem>
                  <ContextMenuItem onSelect={() => transitionTo(`/library/${entry().instance.id}/settings`)}>{t('nav.settings')}</ContextMenuItem>
                  <Show when={nativeInstances}><ContextMenuItem onSelect={() => void openNativeInstanceFolder(entry().instance.id)}>{t('instance-actions.folders')}</ContextMenuItem></Show>
                  <ContextMenuSeparator />
                  <ContextMenuItem disabled={index() === 0} onSelect={() => movePin(entry().instance.id, -1)}>
                    {t('common.move-up')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={index() === pinnedInstances().length - 1}
                    onSelect={() => movePin(entry().instance.id, 1)}
                  >
                    {t('common.move-down')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => togglePin(entry().instance.id)}>{t('common.unpin')}</ContextMenuItem>
                </ContextMenu>
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
