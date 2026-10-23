// A server in the Servers grid, drawn with the instance card's own hooks so it shares its
// size, art scrim, status tag and hover action. Actions live in the context menu, as on
// instance cards.
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, Tooltip, toast } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { Icon } from '../../components/icon';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { serverArt } from '../../features/servers/art';
import { errorMessage } from '../../features/servers/errors';
import { IntentMemo, lifecycleControls, minecraftFact, playersFact, statusDot } from '../../features/servers/model';
import { putOperations, serverCommand, serverRefreshing, updateServer } from '../../features/servers/store';
import { refreshServerWithFeedback } from './refresh-button';
import type { ServerCommandError, ServerSnapshot } from '../../features/servers/native';
import { RemoveServerDialog } from './remove-dialog';
import '../../features/instances/instance-card.css';

type Tag = { status: string; label: MessageId };

/** Card tag and tone, following the instance card's status vocabulary. */
function cardState(snapshot: ServerSnapshot): { tone: string; tag: Tag | null } {
  switch (statusDot(snapshot)) {
    case 'online': return { tone: 'success', tag: { status: 'running', label: 'servers.card.online' } };
    case 'starting': return { tone: 'warning', tag: { status: 'warming', label: 'servers.card.starting' } };
    case 'problem': return { tone: 'danger', tag: { status: 'crashed', label: 'servers.card.attention' } };
    case 'offline': return { tone: 'neutral', tag: { status: 'offline', label: 'servers.card.unreachable' } };
    default: return { tone: 'neutral', tag: null };
  }
}

export function ServerCard(props: { snapshot: ServerSnapshot; now: number }) {
  const [busy, setBusy] = createSignal(false, { name: 'server-card:busy' });
  const [removing, setRemoving] = createSignal(false, { name: 'server-card:removing' });
  const intents = new IntentMemo();
  const id = () => props.snapshot.connection.id;
  const href = () => `/servers/${id()}`;
  const state = () => cardState(props.snapshot);
  const controls = () => lifecycleControls(props.snapshot);
  /** The card's quick action: Start when stopped, Stop while running; never Force kill. */
  const quick = () => (controls().primary === 'start' || controls().primary === 'stop' ? controls().primary as 'start' | 'stop' : null);
  const players = () => playersFact(props.snapshot.status, props.now);

  const runQuick = async (event?: Event) => {
    event?.stopPropagation();
    const action = quick();
    if (!action || busy()) return;
    const generation = props.snapshot.status?.generation ?? null;
    setBusy(true);
    try {
      const operation = await serverCommand((client) => client.lifecycle(id(), action, generation, intents.idFor({ action, generation })));
      intents.settle();
      putOperations(id(), [{ ...operation, intent: operation.intent ?? `lifecycle.${action}` }]);
      toast.show({ title: t('servers.operation.accepted-toast', { name: t(action === 'start' ? 'servers.lifecycle.start' : 'servers.lifecycle.stop') }), tone: 'neutral' });
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      toast.show({ title: t(errorMessage(reason)), tone: 'danger' });
    } finally {
      setBusy(false);
    }
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
            {(tag) => <span data-vesta="instance-card-tag" data-status={tag().status}>{t(tag().label)}</span>}
          </Show>
        </div>
        <Show when={quick()}>
          {(action) => (
            <Tooltip
              content={t(action() === 'start' ? 'servers.lifecycle.start' : 'servers.lifecycle.stop')}
              placement="top"
              trigger={(tooltip) => (
                <button
                  {...tooltip}
                  type="button"
                  data-vesta="instance-card-play"
                  data-variant={busy() ? 'busy' : action() === 'start' ? 'launch' : 'kill'}
                  aria-label={t(action() === 'start' ? 'servers.lifecycle.start' : 'servers.lifecycle.stop')}
                  aria-busy={busy() ? 'true' : undefined}
                  disabled={busy()}
                  onClick={(event) => void runQuick(event)}
                >
                  <Show when={!busy()} fallback={<span data-vesta="instance-card-spinner" aria-hidden="true" />}>
                    <Icon name={action() === 'start' ? 'icons/actions/play' : 'icons/actions/stop'} size={14} />
                  </Show>
                </button>
              )}
            />
          )}
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
          {(action) => <ContextMenuItem disabled={busy()} onSelect={() => void runQuick()}>{t(action() === 'start' ? 'servers.lifecycle.start' : 'servers.lifecycle.stop')}</ContextMenuItem>}
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
