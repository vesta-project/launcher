import { Button, Dialog, SegmentedControl, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextField, toast } from '@vesta/ui';
import { For, Show, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { formatNumber, t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { IntentMemo, isPlayerName } from '../../../features/servers/model';
import { invalidateServerResources, useServerResource } from '../../../features/servers/resources';
import { bansResource, operatorsResource, whitelistResource } from '../../../features/servers/server-resources';
import { agentReachable } from '../../../features/servers/shell-model';
import { putOperations, serverCommand, useServerRoster, useServersClock } from '../../../features/servers/store';
import type { ModerationAction, PlayersView, ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { ServerErrorNote } from '../parts';

type ListView = 'whitelist' | 'ops' | 'bans';
type Request = { action: ModerationAction['action']; player: string };

/** Moderation changes any of the player lists; shown lists revalidate, keeping their rows meanwhile. */
const PLAYER_RESOURCES = ['players', 'whitelist', 'operators', 'bans'];

const running = (snapshot: ServerSnapshot) => snapshot.status?.state === 'running' && !!snapshot.status.generation;

/**
 * Who is online right now, for the Overview. Names come from the agent for the current run;
 * a list from another run, or a count the server can't observe, reads as unknown.
 */
export function OnlinePlayersPanel(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const [dialog, setDialog] = createSignal<Request | null>(null, { name: 'server-online:dialog' });
  const generation = () => props.snapshot.status?.generation ?? null;
  const reachable = () => agentReachable(props.snapshot);
  const live = () => reachable() && running(props.snapshot);
  const players = useServerRoster(() => props.snapshot);
  const moderate = () => gate(props.snapshot.capabilities, 'players.moderate') !== 'denied';
  /** The list for the run on screen, or null when it can't be trusted. */
  const known = () => {
    const value: PlayersView | undefined = players.value();
    if (!value?.known || value.generation !== generation()) return null;
    return value;
  };
  const count = () => (live() ? known()?.playerCount ?? null : null);

  return (
    <section data-vesta="server-recent" data-server-online>
      <h2>
        {t('servers.overview.online-players')}
        <Show when={count() !== null}><span data-vesta="instance-tab-count">{formatNumber(count()!)}</span></Show>
      </h2>
      <ServerErrorNote error={players.error()} onRetry={() => void players.refresh()} />
      <Show
        when={live() ? known() : null}
        fallback={
          <p data-vesta="server-muted" data-server-online-note>
            {!reachable()
              ? t('servers.players.unknown-offline')
              : !running(props.snapshot)
                ? t('servers.players.not-running')
                : players.loading() ? t('servers.loading') : t('servers.players.unknown')}
          </p>
        }
      >
        {(list) => (
          <Show
            when={list().names.length > 0}
            fallback={
              <p data-vesta="server-muted" data-server-online-note>
                {/* The agent withholds names it can't safely display; the count stays authoritative. */}
                {list().playerCount > 0 ? t('servers.players.names-withheld', { count: list().playerCount }) : t('servers.players.nobody')}
              </p>
            }
          >
            <ul data-vesta="server-activity-list" data-server-players>
              <For each={list().names}>
                {(name) => (
                  <li data-vesta="server-activity-row" data-compact>
                    <span data-vesta="server-activity-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
                    <p data-vesta="server-activity-line"><strong>{name}</strong></p>
                    <Show when={moderate()}>
                      <div data-vesta="server-row-actions">
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ action: 'kick', player: name })}>{t('servers.moderate.kick')}</Button>
                        <Button size="sm" variant="ghost" tone="danger" onClick={() => setDialog({ action: 'ban', player: name })}>{t('servers.moderate.ban')}</Button>
                      </div>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
      <Show when={dialog()} keyed>
        {(request) => <ModerationDialog snapshot={props.snapshot} request={request} onClose={() => setDialog(null)} onDone={() => invalidateServerResources(id(), PLAYER_RESOURCES)} />}
      </Show>
    </section>
  );
}

/** Whitelist, operators and bans, in the Players settings section. */
export function PlayerListsSection(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const [view, setView] = createSignal<ListView>('whitelist', { name: 'server-players:view' });
  const [dialog, setDialog] = createSignal<Request | null>(null, { name: 'server-players:dialog' });
  const whitelist = useServerResource(id, whitelistResource, { enabled: () => view() === 'whitelist' });
  const ops = useServerResource(id, operatorsResource, { enabled: () => view() === 'ops' });
  const bans = useServerResource(id, bansResource, { enabled: () => view() === 'bans' });
  const current = () => (view() === 'whitelist' ? whitelist : view() === 'ops' ? ops : bans);
  const moderate = () => gate(props.snapshot.capabilities, 'players.moderate') !== 'denied';
  const operator = () => gate(props.snapshot.capabilities, 'players.operator') !== 'denied';
  const live = () => running(props.snapshot);

  const views: { value: ListView; label: MessageId }[] = [
    { value: 'whitelist', label: 'servers.players.whitelist' },
    { value: 'ops', label: 'servers.players.operators' },
    { value: 'bans', label: 'servers.players.bans' },
  ];

  return (
    <div data-vesta="server-players">
      <div data-vesta="server-players-bar">
        <SegmentedControl aria-label={t('servers.tab.players')} value={view()} onChange={(value) => setView(value as ListView)} options={views.map((entry) => ({ value: entry.value, label: t(entry.label) }))} />
        <Show when={moderate() && live() && view() !== 'ops'}>
          <Button size="sm" variant="outline" onClick={() => setDialog({ action: view() === 'bans' ? 'ban' : 'whitelist_add', player: '' })}>
            {t(view() === 'bans' ? 'servers.players.ban-player' : 'servers.players.add-whitelist')}
          </Button>
        </Show>
        <Show when={operator() && live() && view() === 'ops'}>
          <Button size="sm" variant="outline" onClick={() => setDialog({ action: 'op', player: '' })}>{t('servers.players.make-operator')}</Button>
        </Show>
        <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/refresh" />} disabled={current().refreshing()} onClick={() => void current().refresh()}>{t('servers.refresh')}</Button>
      </div>
      <ServerErrorNote error={current().error()} onRetry={() => void current().refresh()} />

      <Show when={current().loading()}><p data-vesta="server-muted">{t('servers.loading')}</p></Show>
      <Show when={view() === 'whitelist' ? whitelist.value() : undefined}>
        {(rows) => (
          <PlayerTable rows={rows()} empty="servers.players.whitelist-empty" actions={(name) => (
            <Show when={moderate() && live()}><Button size="sm" variant="ghost" onClick={() => setDialog({ action: 'whitelist_remove', player: name })}>{t('common.remove')}</Button></Show>
          )} />
        )}
      </Show>
      <Show when={view() === 'ops' ? ops.value() : undefined}>
        {(rows) => (
          <PlayerTable rows={rows().map((entry) => ({ name: entry.name, detail: t('servers.players.level', { count: entry.level }) }))} empty="servers.players.ops-empty" actions={(name) => (
            <Show when={operator() && live()}><Button size="sm" variant="ghost" onClick={() => setDialog({ action: 'deop', player: name })}>{t('servers.moderate.deop')}</Button></Show>
          )} />
        )}
      </Show>
      <Show when={view() === 'bans' ? bans.value() : undefined}>
        {(rows) => (
          <PlayerTable rows={rows().map((entry) => ({ name: entry.name, detail: entry.reason }))} empty="servers.players.bans-empty" actions={(name) => (
            <Show when={moderate() && live()}><Button size="sm" variant="ghost" onClick={() => setDialog({ action: 'pardon', player: name })}>{t('servers.moderate.pardon')}</Button></Show>
          )} />
        )}
      </Show>

      <Show when={dialog()} keyed>
        {(request) => <ModerationDialog snapshot={props.snapshot} request={request} onClose={() => setDialog(null)} onDone={() => invalidateServerResources(id(), PLAYER_RESOURCES)} />}
      </Show>
    </div>
  );
}

function PlayerTable(props: { rows: { name: string; detail?: string }[]; empty?: MessageId; actions: (name: string) => unknown }) {
  return (
    <Show when={props.rows.length > 0} fallback={<Show when={props.empty}><p data-vesta="server-muted">{t(props.empty!)}</p></Show>}>
      <Table>
        <TableHeader>
          <TableRow><TableHead>{t('servers.players.name')}</TableHead><TableHead>{t('servers.players.detail')}</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          <For each={props.rows}>
            {(row) => (
              <TableRow>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.detail ?? ''}</TableCell>
                <TableCell><div data-vesta="server-row-actions">{props.actions(row.name) as never}</div></TableCell>
              </TableRow>
            )}
          </For>
        </TableBody>
      </Table>
    </Show>
  );
}

const actionTitles: Record<ModerationAction['action'], MessageId> = {
  kick: 'servers.moderate.kick', ban: 'servers.moderate.ban', pardon: 'servers.moderate.pardon',
  whitelist_add: 'servers.players.add-whitelist', whitelist_remove: 'servers.moderate.whitelist-remove',
  op: 'servers.players.make-operator', deop: 'servers.moderate.deop', kill: 'servers.moderate.kill', lightning: 'servers.moderate.lightning',
};

function ModerationDialog(props: {
  snapshot: ServerSnapshot;
  /** Each request mounts a fresh dialog, so its fields start from the request. */
  request: { action: ModerationAction['action']; player: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const now = useServersClock();
  const [player, setPlayer] = createSignal(untrack(() => props.request.player));
  const [reason, setReason] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<ServerCommandError | null>(null);
  const [awaiting, setAwaiting] = createSignal<{ intentId: string; expiresAtMs: number; player: string } | null>(null);
  const [uncertain, setUncertain] = createSignal(false);
  const intents = new IntentMemo();
  const action = () => props.request.action;
  const takesReason = () => action() === 'kick' || action() === 'ban';
  const remaining = () => Math.max(0, Math.ceil(((awaiting()?.expiresAtMs ?? 0) - now()) / 1000));
  /** Once prepared, the confirmation is bound to that exact player; the field locks. */
  const locked = () => !!props.request.player || (!!awaiting() && remaining() > 0);

  const submit = async () => {
    const kind = action();
    const generation = props.snapshot.status?.generation;
    if (!kind || !generation || !isPlayerName(player())) return;
    setBusy(true); setError(null);
    const id = props.snapshot.connection.id;
    try {
      const pending = awaiting();
      if (pending && remaining() > 0) {
        const operation = await serverCommand((client) => client.moderateConfirm(id, pending.intentId));
        putOperations(id, [{ ...operation, intent: operation.intent ?? 'players.moderate' }]);
      } else {
        const request = { action: kind, player: player(), ...(takesReason() && reason().trim() ? { reason: reason().trim() } : {}) } as ModerationAction;
        // Identical retries after an uncertain outcome keep the same intent.
        const intentId = intents.idFor({ request, generation });
        const result = await serverCommand((client) => client.moderate(id, request, generation, intentId));
        intents.settle();
        if (result.kind === 'awaitingConfirmation') { setAwaiting({ intentId, expiresAtMs: result.expiresAtMs, player: request.player }); return; }
        putOperations(id, [{ ...result.operation, intent: result.operation.intent ?? 'players.moderate' }]);
      }
      toast.show({ title: t('servers.moderate.accepted'), tone: 'neutral' });
      props.onDone();
      props.onClose();
    } catch (reason) {
      const failure = reason as ServerCommandError;
      if (!awaiting()) intents.settle(failure);
      setUncertain(intents.uncertain);
      setError(failure);
      if (failure.code === 'confirmation_expired') setAwaiting(null);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      title={t(actionTitles[action()])}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button tone={action() === 'ban' || action() === 'op' ? 'danger' : 'accent'} disabled={busy() || !isPlayerName(player())} onClick={() => void submit()}>
            {awaiting() && remaining() > 0 ? t('servers.moderate.confirm', { count: remaining() }) : t('servers.moderate.apply')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('servers.players.name')}
        value={player()}
        onChange={setPlayer}
        readOnly={locked()}
        error={player() && !isPlayerName(player()) ? t('servers.players.name-format') : undefined}
        spellcheck="false"
      />
      <Show when={takesReason()}>
        <TextField label={t('servers.moderate.reason')} value={reason()} onChange={setReason} maxlength={256} />
      </Show>
      <Show when={action() === 'op'}>
        <p data-vesta="server-callout" data-tone="warning">{t('servers.moderate.op-warning')}</p>
      </Show>
      <Show when={awaiting() && remaining() > 0}>
        <p data-vesta="server-callout" data-tone="warning">{t('servers.moderate.confirm-target', { name: awaiting()!.player })}</p>
      </Show>
      <Show when={uncertain()}>
        <p data-vesta="server-muted" role="status">{t('servers.operation.uncertain-retry')}</p>
      </Show>
      <p data-vesta="server-muted">{t('servers.moderate.delivery-note')}</p>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}
