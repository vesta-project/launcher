// A server in the Servers grid, drawn with the instance card's own hooks so it shares its
// size, art scrim, status tag and hover action. Actions live in the context menu, as on
// instance cards.
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, Tooltip } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { Icon } from '../../components/icon';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { serverArt } from '../../features/servers/art';
import { lifecycleControls, minecraftFact, playersFact, quickAction, statusDot } from '../../features/servers/model';
import { serverRefreshing, updateServer } from '../../features/servers/store';
import { refreshServerWithFeedback } from './refresh-button';
import type { ServerSnapshot } from '../../features/servers/native';
import { actionIcons, actionLabels, useLifecycle } from './lifecycle';
import { RemoveServerDialog } from './remove-dialog';
import '../../features/instances/instance-card.css';

type Tag = { status: string; label: MessageId };

/** Card tag and tone, following the instance card's status vocabulary. */
function cardState(snapshot: ServerSnapshot): { tone: string; tag: Tag | null } {
  switch (statusDot(snapshot)) {
    case 'online': return { tone: 'success', tag: { status: 'running', label: 'servers.card.online' } };
    case 'starting': return { tone: 'warning', tag: { status: 'warming', label: 'servers.card.starting' } };
    case 'sleeping': return { tone: 'neutral', tag: { status: 'sleeping', label: 'servers.card.sleeping' } };
    case 'problem': return { tone: 'danger', tag: { status: 'crashed', label: 'servers.card.attention' } };
    case 'offline': return { tone: 'neutral', tag: { status: 'offline', label: 'servers.card.unreachable' } };
    default: return { tone: 'neutral', tag: null };
  }
}

export function ServerCard(props: { snapshot: ServerSnapshot; now: number }) {
  const [removing, setRemoving] = createSignal(false, { name: 'server-card:removing' });
  const lifecycle = useLifecycle(() => props.snapshot);
  const id = () => props.snapshot.connection.id;
  const href = () => `/servers/${id()}`;
  const state = () => cardState(props.snapshot);
  const controls = () => lifecycleControls(props.snapshot);
  const quick = () => quickAction(props.snapshot);
  const busy = () => !!lifecycle.busy() || controls().progress !== null;
  const players = () => playersFact(props.snapshot.status, props.now);

  const runQuick = (event?: Event) => {
    event?.stopPropagation();
    const action = quick();
    if (action && !busy()) void lifecycle.submit(action);
  };

  const open = () => transitionTo(href());

  const card = (triggerProps: Record<string, unknown>): JSX.Element => (
    <div
      {...triggerProps}
      data-vesta="instance-card"
      data-server-card
      data-status={state().tag?.status ?? 'idle'}
      data-tone={state().tone}
      role="group"
      aria-label={props.snapshot.connection.name}
      tabindex={0}
      style={{ '--instance-card-image': `url("${serverArt(props.snapshot.connection.serverId || id())}")` } as JSX.CSSProperties}
      onClick={open}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } }}
    >
      <div data-vesta="instance-card-top">
        <div data-vesta="instance-card-indicators">
          <Show when={state().tag}>
            {(tag) => (
              <span data-vesta="instance-card-tag" data-status={tag().status}>
                <Show when={tag().status === 'sleeping'}><Icon name="icons/status/moon" size={11} /></Show>
                {t(tag().label)}
              </span>
            )}
          </Show>
        </div>
        <Show when={quick() || controls().progress}>
          <Tooltip
            content={quick() ? t(actionLabels[quick()!]) : t(controls().progress === 'waking' ? 'servers.lifecycle.waking' : 'servers.lifecycle.starting')}
            placement="top"
            trigger={(tooltip) => (
              <button
                {...tooltip}
                type="button"
                data-vesta="instance-card-play"
                data-variant={busy() ? 'busy' : quick() === 'start' ? 'launch' : quick() === 'wake' ? 'wake' : quick() === 'sleep' ? 'sleep' : 'kill'}
                aria-label={quick() && !busy() ? t(actionLabels[quick()!]) : t(controls().progress === 'waking' ? 'servers.lifecycle.waking' : 'servers.lifecycle.starting')}
                aria-busy={busy() ? 'true' : undefined}
                disabled={busy()}
                onClick={(event) => runQuick(event)}
              >
                <Show when={!busy() && quick()} fallback={<span data-vesta="instance-card-spinner" aria-hidden="true" />}>
                  {(action) => <Icon name={actionIcons[action()]} size={14} />}
                </Show>
              </button>
            )}
          />
        </Show>
      </div>
      <div data-vesta="instance-card-bottom">
        <h3 data-vesta="instance-card-name">{props.snapshot.connection.name}</h3>
        <div data-vesta="instance-card-meta">
          <Show when={props.snapshot.info?.minecraftVersion}>{(version) => <span>{version()}</span>}</Show>
          <span>{t(props.snapshot.status?.state === 'running' ? players().message : minecraftFact(props.snapshot.status).message, players().args)}</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <ContextMenu trigger={card}>
        <ContextMenuItem onSelect={open}>{t('servers.open')}</ContextMenuItem>
        <ContextMenuItem disabled={serverRefreshing(id())} onSelect={() => void refreshServerWithFeedback(id())}>{t('servers.refresh')}</ContextMenuItem>
        <Show when={quick()}>
          {(action) => <ContextMenuItem disabled={busy()} onSelect={() => runQuick()}>{t(actionLabels[action()])}</ContextMenuItem>}
        </Show>
        <Show when={controls().stop}>
          <ContextMenuItem disabled={busy()} onSelect={() => void lifecycle.submit('stop')}>{t('servers.lifecycle.stop')}</ContextMenuItem>
        </Show>
        <ContextMenuItem onSelect={() => transitionTo(`${href()}/console`)}>{t('servers.tab.console')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void updateServer(id(), { pinned: !props.snapshot.connection.pinned })}>
          {props.snapshot.connection.pinned ? t('common.unpin') : t('servers.pin')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => transitionTo(`${href()}/connection`)}>{t('servers.tab.connection')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => setRemoving(true)}>{t('servers.remove')}</ContextMenuItem>
      </ContextMenu>
      <RemoveServerDialog snapshot={props.snapshot} open={removing()} onOpenChange={setRemoving} />
    </>
  );
}
