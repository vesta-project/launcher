// A server in the Servers grid, drawn with the instance card's own hooks so it shares its
// size, art scrim, status tag and hover action. Actions live in the context menu, as on
// instance cards.
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, Tooltip } from '@vesta/ui';
import { Show, createSignal, onCleanup } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { Icon } from '../../components/icon';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { serverArt } from '../../features/servers/art';
import { hostIdOf } from '../../features/servers/host-model';
import { lifecycleControls, minecraftFact, playersFact, quickAction, statusDot } from '../../features/servers/model';
import { serverRefreshing, updateServer } from '../../features/servers/store';
import { refreshServerWithFeedback } from './refresh-button';
import type { ServerSnapshot } from '../../features/servers/native';
import { actionIcons, actionLabels, useLifecycle } from './lifecycle';
import { KillDialog, StartKillQuick } from './kill';
import { RemoveServerDialog } from './remove-dialog';
import { HostRemoveDialog, machineRemoval } from './host-remove-dialog';
import { GetModpackDialog, canGetModpack, offersClientPack } from './pack/get-modpack';
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
  const [creating, setCreating] = createSignal(false, { name: 'server-card:creating' });
  const [killing, setKilling] = createSignal(false, { name: 'server-card:killing' });
  const [removingFromMachine, setRemovingFromMachine] = createSignal(false, { name: 'server-card:removing-from-machine' });
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
  // Hover settles back to rest for a moment after the pointer leaves, like an instance card.
  const [leaving, setLeaving] = createSignal(false, { name: 'server-card:leaving' });
  let leaveTimer: number | undefined;
  onCleanup(() => window.clearTimeout(leaveTimer));
  const leave = () => {
    setLeaving(true);
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => setLeaving(false), 250);
  };

  const card = (triggerProps: Record<string, unknown>): JSX.Element => (
    <div
      {...triggerProps}
      data-vesta="instance-card"
      data-server-card
      data-preload-server={id()}
      data-status={state().tag?.status ?? 'idle'}
      data-tone={state().tone}
      data-leaving={leaving() ? '' : undefined}
      role="group"
      aria-label={props.snapshot.connection.name}
      tabindex={0}
      style={{ '--instance-card-image': `url("${serverArt(props.snapshot.connection.serverId || id())}")` } as JSX.CSSProperties}
      onClick={open}
      onPointerLeave={leave}
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
        <Show when={controls().progress}>
          {(progress) => <StartKillQuick progress={progress()} canKill={controls().primary === 'kill'} onKill={() => setKilling(true)} />}
        </Show>
        <Show when={!controls().progress && quick()}>
          <Tooltip
            content={t(actionLabels[quick()!])}
            placement="top"
            trigger={(tooltip) => (
              <button
                {...tooltip}
                type="button"
                data-vesta="instance-card-play"
                data-card-play=""
                data-running={state().tag?.status === 'running' ? '' : undefined}
                data-variant={busy() ? 'busy' : quick() === 'start' ? 'launch' : quick() === 'wake' ? 'wake' : quick() === 'sleep' ? 'sleep' : 'kill'}
                aria-label={quick() && !busy() ? t(actionLabels[quick()!]) : t('servers.lifecycle.sending')}
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
          <Show when={props.snapshot.state.phase === 'online' && props.snapshot.status?.state === 'running'}
            fallback={<span>{t(minecraftFact(props.snapshot.status, props.snapshot.publicLifecycle).message)}</span>}>
            <span data-vesta="server-card-players" role="img" aria-label={t(players().message, players().args)} data-tip={t(players().message, players().args)}>
              <Icon name="icons/content/people" size={13} />{players().args?.count ?? '?'}
            </span>
          </Show>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Same order and look as an instance card's menu: the main action, where to go, the
          card's own settings, then removal, each group split once. */}
      <ContextMenu trigger={card}>
        <Show when={quick()}>
          {(action) => <ContextMenuItem icon={<Icon name={actionIcons[action()]} />} disabled={busy()} onSelect={() => runQuick()}>{t(actionLabels[action()])}</ContextMenuItem>}
        </Show>
        <Show when={controls().stop}>
          <ContextMenuItem icon={<Icon name="icons/actions/stop" />} disabled={busy()} onSelect={() => void lifecycle.submit('stop')}>{t('servers.lifecycle.stop')}</ContextMenuItem>
        </Show>
        <Show when={controls().primary === 'kill'}>
          <ContextMenuItem icon={<Icon name="icons/actions/stop" />} tone="danger" onSelect={() => setKilling(true)}>{t('servers.lifecycle.kill')}</ContextMenuItem>
        </Show>
        <ContextMenuItem icon={<Icon name="icons/rail/servers" />} onSelect={open}>{t('servers.open')}</ContextMenuItem>
        <ContextMenuItem icon={<Icon name="icons/content/terminal" />} onSelect={() => transitionTo(`${href()}/console`)}>{t('servers.tab.console')}</ContextMenuItem>
        <Show when={canGetModpack(props.snapshot) && offersClientPack(props.snapshot)}>
          <ContextMenuItem icon={<Icon name="icons/actions/add" />} onSelect={() => setCreating(true)}>{t('server-pack.play-create')}</ContextMenuItem>
        </Show>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Icon name={props.snapshot.connection.pinned ? 'icons/actions/unpin' : 'icons/actions/pin'} />} onSelect={() => void updateServer(id(), { pinned: !props.snapshot.connection.pinned })}>
          {props.snapshot.connection.pinned ? t('common.unpin') : t('servers.pin')}
        </ContextMenuItem>
        <ContextMenuItem icon={<Icon name="icons/content/link" />} onSelect={() => transitionTo(`${href()}/connection`)}>{t('servers.tab.connection')}</ContextMenuItem>
        <Show when={hostIdOf(props.snapshot)}>
          {(hostId) => <ContextMenuItem icon={<Icon name="icons/rail/settings" />} onSelect={() => transitionTo(`/servers/host/${hostId()}`)}>{t('vesta-server.list.machine-settings')}</ContextMenuItem>}
        </Show>
        <ContextMenuItem icon={<Icon name="icons/actions/refresh" />} disabled={serverRefreshing(id())} onSelect={() => void refreshServerWithFeedback(id())}>{t('servers.refresh')}</ContextMenuItem>
        <ContextMenuSeparator />
        {/* An owner removes it from its Vesta Server (it can come back there for 7 days);
            otherwise this launcher just stops listing it. */}
        <Show when={machineRemoval(props.snapshot)} fallback={<ContextMenuItem icon={<Icon name="icons/actions/close" />} onSelect={() => setRemoving(true)}>{t('servers.forget')}</ContextMenuItem>}>
          {(where) => <ContextMenuItem icon={<Icon name="icons/actions/delete" />} tone="danger" onSelect={() => setRemovingFromMachine(true)}>{t('servers.host-remove.menu', { machine: where() })}</ContextMenuItem>}
        </Show>
      </ContextMenu>
      <RemoveServerDialog snapshot={props.snapshot} open={removing()} onOpenChange={setRemoving} />
      <HostRemoveDialog snapshot={props.snapshot} open={removingFromMachine()} onOpenChange={setRemovingFromMachine} />
      <KillDialog snapshot={props.snapshot} open={killing()} onOpenChange={setKilling} />
      <Show when={creating()}><GetModpackDialog snapshot={props.snapshot} mode="new" onClose={() => setCreating(false)} /></Show>
    </>
  );
}
