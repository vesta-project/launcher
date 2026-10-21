import { Button, Dialog, SegmentedControl, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextField, toast } from '@vesta/ui';
import { For, Show, createEffect, createSignal, untrack } from 'solid-js';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { errorMessage } from '../../../features/servers/errors';
import { isPlayerName, newIntentId } from '../../../features/servers/model';
import { putOperations, serverCommand, useServersClock } from '../../../features/servers/store';
import type { BanEntry, ModerationAction, OperatorEntry, PlayersView, ServerCommandError, ServerSnapshot, WhitelistEntry } from '../../../features/servers/native';
import { ServerErrorNote } from '../parts';

type View = 'online' | 'whitelist' | 'ops' | 'bans';

export function PlayersTab(props: { snapshot: ServerSnapshot }) {
  const id = () => props.snapshot.connection.id;
  const [view, setView] = createSignal<View>('online');
  const [online, setOnline] = createSignal<PlayersView | null>(null);
  const [whitelist, setWhitelist] = createSignal<WhitelistEntry[]>([]);
  const [ops, setOps] = createSignal<OperatorEntry[]>([]);
  const [bans, setBans] = createSignal<BanEntry[]>([]);
  const [error, setError] = createSignal<ServerCommandError | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [dialog, setDialog] = createSignal<{ action: ModerationAction['action']; player: string } | null>(null);
  const moderate = () => gate(props.snapshot.capabilities, 'players.moderate') !== 'denied';
  const operator = () => gate(props.snapshot.capabilities, 'players.operator') !== 'denied';
  const running = () => props.snapshot.status?.state === 'running' && !!props.snapshot.status.generation;

  const load = async (target: View) => {
    setLoading(true);
    setError(null);
    try {
      if (target === 'online') setOnline(await serverCommand((client) => client.players(id())));
      if (target === 'whitelist') setWhitelist(await serverCommand((client) => client.whitelist(id())));
      if (target === 'ops') setOps(await serverCommand((client) => client.operators(id())));
      if (target === 'bans') setBans(await serverCommand((client) => client.bans(id())));
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setLoading(false); }
  };
  // Fetch on navigation and on generation change only; no timers.
  createEffect(() => ({ view: view(), generation: props.snapshot.status?.generation ?? null }), ({ view: target }) => { void load(target); }, { name: 'server-players:load' });

  const views: { value: View; label: MessageId }[] = [
    { value: 'online', label: 'servers.players.online' },
    { value: 'whitelist', label: 'servers.players.whitelist' },
    { value: 'ops', label: 'servers.players.operators' },
    { value: 'bans', label: 'servers.players.bans' },
  ];

  return (
    <div data-vesta="server-players">
      <div data-vesta="server-players-bar">
        <SegmentedControl aria-label={t('servers.tab.players')} value={view()} onChange={(value) => setView(value as View)} options={views.map((entry) => ({ value: entry.value, label: t(entry.label) }))} />
        <Show when={moderate() && running() && view() !== 'online' && view() !== 'ops'}>
          <Button size="sm" variant="outline" onClick={() => setDialog({ action: view() === 'bans' ? 'ban' : 'whitelist_add', player: '' })}>
            {t(view() === 'bans' ? 'servers.players.ban-player' : 'servers.players.add-whitelist')}
          </Button>
        </Show>
        <Show when={operator() && running() && view() === 'ops'}>
          <Button size="sm" variant="outline" onClick={() => setDialog({ action: 'op', player: '' })}>{t('servers.players.make-operator')}</Button>
        </Show>
        <Button size="sm" variant="ghost" disabled={loading()} onClick={() => void load(view())}>{t('common.retry')}</Button>
      </div>
      <ServerErrorNote error={error()} onRetry={() => void load(view())} />

      <Show when={view() === 'online'}>
        <Show when={online()}>
          {(players) => (
            <Show when={players().known ? players() as Extract<PlayersView, { known: true }> : undefined} fallback={<p data-vesta="server-muted">{running() ? t('servers.players.unknown') : t('servers.players.none-running')}</p>}>
              {(known) => (
                <Show when={known().names.length > 0} fallback={<p data-vesta="server-muted">{t('servers.players.nobody')}</p>}>
                  <PlayerTable rows={known().names.map((name) => ({ name }))} actions={(name) => (
                    <Show when={moderate() && running()}>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ action: 'kick', player: name })}>{t('servers.moderate.kick')}</Button>
                      <Button size="sm" variant="ghost" tone="danger" onClick={() => setDialog({ action: 'ban', player: name })}>{t('servers.moderate.ban')}</Button>
                    </Show>
                  )} />
                </Show>
              )}
            </Show>
          )}
        </Show>
      </Show>
      <Show when={view() === 'whitelist'}>
        <PlayerTable rows={whitelist()} empty="servers.players.whitelist-empty" actions={(name) => (
          <Show when={moderate() && running()}><Button size="sm" variant="ghost" onClick={() => setDialog({ action: 'whitelist_remove', player: name })}>{t('common.remove')}</Button></Show>
        )} />
      </Show>
      <Show when={view() === 'ops'}>
        <PlayerTable rows={ops().map((entry) => ({ name: entry.name, detail: t('servers.players.level', { count: entry.level }) }))} empty="servers.players.ops-empty" actions={(name) => (
          <Show when={operator() && running()}><Button size="sm" variant="ghost" onClick={() => setDialog({ action: 'deop', player: name })}>{t('servers.moderate.deop')}</Button></Show>
        )} />
      </Show>
      <Show when={view() === 'bans'}>
        <PlayerTable rows={bans().map((entry) => ({ name: entry.name, detail: entry.reason }))} empty="servers.players.bans-empty" actions={(name) => (
          <Show when={moderate() && running()}><Button size="sm" variant="ghost" onClick={() => setDialog({ action: 'pardon', player: name })}>{t('servers.moderate.pardon')}</Button></Show>
        )} />
      </Show>

      <Show when={dialog()} keyed>
        {(request) => <ModerationDialog snapshot={props.snapshot} request={request} onClose={() => setDialog(null)} onDone={() => void load(view())} />}
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
  const [awaiting, setAwaiting] = createSignal<{ intentId: string; expiresAtMs: number } | null>(null);
  const action = () => props.request.action;
  const takesReason = () => action() === 'kick' || action() === 'ban';
  const remaining = () => Math.max(0, Math.ceil(((awaiting()?.expiresAtMs ?? 0) - now()) / 1000));

  const submit = async () => {
    const kind = action();
    const generation = props.snapshot.status?.generation;
    if (!kind || !generation || !isPlayerName(player())) return;
    setBusy(true); setError(null);
    try {
      const id = props.snapshot.connection.id;
      const pending = awaiting();
      if (pending && remaining() > 0) {
        putOperations(id, [await serverCommand((client) => client.moderateConfirm(id, pending.intentId))]);
      } else {
        const request = { action: kind, player: player(), ...(takesReason() && reason().trim() ? { reason: reason().trim() } : {}) } as ModerationAction;
        const intentId = newIntentId();
        const result = await serverCommand((client) => client.moderate(id, request, generation, intentId));
        if (result.kind === 'awaitingConfirmation') { setAwaiting({ intentId, expiresAtMs: result.expiresAtMs }); return; }
        putOperations(id, [{ ...result.operation, intent: result.operation.intent ?? 'players.moderate' }]);
      }
      toast.show({ title: t('servers.moderate.sent'), tone: 'neutral' });
      props.onDone();
      props.onClose();
    } catch (reason) {
      setError(reason as ServerCommandError);
      if ((reason as ServerCommandError).code === 'confirmation_expired') setAwaiting(null);
      else toast.show({ title: t(errorMessage(reason)), tone: 'danger' });
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
        readOnly={!!props.request.player}
        error={player() && !isPlayerName(player()) ? t('servers.players.name-format') : undefined}
        spellcheck={false}
      />
      <Show when={takesReason()}>
        <TextField label={t('servers.moderate.reason')} value={reason()} onChange={setReason} maxlength={256} />
      </Show>
      <Show when={action() === 'op'}>
        <p data-vesta="server-callout" data-tone="warning">{t('servers.moderate.op-warning')}</p>
      </Show>
      <p data-vesta="server-muted">{t('servers.moderate.delivery-note')}</p>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}
