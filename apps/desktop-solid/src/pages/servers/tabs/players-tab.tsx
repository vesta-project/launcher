import { Metadata } from '../../../components/metadata';
import { Badge, Button, Dialog, IconButton, SegmentedControl, Select, TextField, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal, untrack } from 'solid-js';
import { EmptyLine, EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { formatDate, formatNumber, t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { isPlayerName, newIntentId } from '../../../features/servers/model';
import { afterFailure, isWhitelist, moderationRequest, routeFor, standing, type Attempt } from '../../../features/servers/moderation-attempt';
import { banDuration } from '../../../features/servers/operations-model';
import {
  BAN_DURATIONS, PLAYER_FILTERS, PLAYER_PAGE_SIZE, playerPage, banExpiry, filterCounts, filterPlayers, mergePlayers, playerChips, shortUuid, type KnownPlayer, type PlayerFilter,
} from '../../../features/servers/player-manager';
import { effectiveValue, parseProperties, propertyDef } from '../../../features/servers/properties-model';
import { invalidateServerResources, useServerResource } from '../../../features/servers/resources';
import { PLAYER_LIST_RESOURCES, bansResource, operatorsResource, propertiesResource, whitelistResource } from '../../../features/servers/server-resources';
import { agentReachable } from '../../../features/servers/shell-model';
import { putOperations, serverCommand, serverPlayers, useServersClock } from '../../../features/servers/store';
import type { ModerationAction, ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { Sensitive, ServerErrorNote } from '../parts';
import { CopyValue, SectionLink, SettingsPage, SettingsSearch } from '../settings-parts';

type Action = ModerationAction['action'];
type Request = { action: Action; player: string; choices?: Action[] };

const running = (snapshot: ServerSnapshot) => snapshot.status?.state === 'running' && !!snapshot.status.generation;

/**
 * Who is online right now, for the Overview, from the shared live roster. Join and leave
 * events keep it current; a roster from another run, or one the server can't observe,
 * reads as unknown.
 */
export function OnlinePlayersPanel(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const [dialog, setDialog] = createSignal<Request | null>(null, { name: 'server-online:dialog' });
  const reachable = () => agentReachable(props.snapshot);
  const live = () => reachable() && running(props.snapshot);
  const moderate = () => gate(props.snapshot.capabilities, 'players.moderate') === 'allowed';
  /** The roster for the run on screen, or null when it can't be trusted. */
  const known = () => {
    const roster = serverPlayers(id());
    return live() && roster.known && roster.generation === props.snapshot.status?.generation ? roster : null;
  };

  return (
    <section data-vesta="server-recent" data-server-online>
      <h2>
        {t('servers.overview.online-players')}
        <Show when={known()}>{(roster) => <span data-vesta="instance-tab-count">{formatNumber(roster().playerCount)}</span>}</Show>
      </h2>
      <Show
        when={known()}
        fallback={
          <EmptyLine>
            {!reachable() ? t('servers.players.unknown-offline') : !running(props.snapshot) ? t('servers.players.not-running') : t('servers.loading')}
          </EmptyLine>
        }
      >
        {(roster) => (
          <Show
            when={roster().names.length > 0}
            fallback={
              <EmptyLine>
                {/* The agent withholds names it can't safely display; the count stays authoritative. */}
                {roster().playerCount > 0 ? t('servers.players.names-withheld', { count: roster().playerCount }) : t('servers.players.nobody')}
              </EmptyLine>
            }
          >
            <ul data-vesta="server-activity-list" data-server-players>
              <For each={roster().names.slice(0, PLAYER_PAGE_SIZE)}>
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
            <Show when={roster().names.length > PLAYER_PAGE_SIZE}>
              <p>{t('servers.people.preview-limit', { count: PLAYER_PAGE_SIZE })}</p>
            </Show>
          </Show>
        )}
      </Show>
      <Show when={dialog()} keyed>
        {(request) => <ModerationDialog snapshot={props.snapshot} request={request} onClose={() => setDialog(null)} onDone={() => invalidateServerResources(id(), PLAYER_LIST_RESOURCES)} />}
      </Show>
    </section>
  );
}

const filterLabels: Record<PlayerFilter, MessageId> = {
  all: 'servers.people.filter-all', online: 'servers.people.filter-online', whitelisted: 'servers.people.filter-whitelisted',
  operators: 'servers.people.filter-operators', banned: 'servers.people.filter-banned',
};

/**
 * Players: everyone the server knows (whitelist, operators, bans and who is online) in one
 * searchable list. A row opens to show the UUID and what you can do about that player.
 */
export function PlayerManager(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const [filter, setFilter] = createSignal<PlayerFilter>('all', { name: 'server-players:filter' });
  const [page, setPage] = createSignal(0, { name: 'server-players:page' });
  const [query, setQuery] = createSignal('', { name: 'server-players:query' });
  const [expanded, setExpanded] = createSignal<string | null>(null, { name: 'server-players:expanded' });
  const [dialog, setDialog] = createSignal<Request | null>(null, { name: 'server-players:dialog' });
  const whitelist = useServerResource(id, whitelistResource);
  const ops = useServerResource(id, operatorsResource);
  const bans = useServerResource(id, bansResource);
  const configVisible = () => gate(props.snapshot.capabilities, 'config.view') === 'allowed';
  const properties = useServerResource(id, propertiesResource, { enabled: configVisible });
  const moderate = () => gate(props.snapshot.capabilities, 'players.moderate') === 'allowed';
  const operator = () => gate(props.snapshot.capabilities, 'players.operator') === 'allowed';
  const live = () => running(props.snapshot);
  /** Whitelist edits also work while stopped or starting: the agent keeps them for the run. */
  const canWhitelist = () => agentReachable(props.snapshot) && !!routeFor('whitelist_add', { state: props.snapshot.status?.state, generation: props.snapshot.status?.generation });
  const canAct = (action: Action) =>
    isWhitelist(action) ? moderate() && canWhitelist() : live() && (action === 'op' || action === 'deop' ? operator() : moderate());

  const players = createMemo(() => mergePlayers({ whitelist: whitelist.value(), ops: ops.value(), bans: bans.value(), roster: serverPlayers(id()) }), { name: 'server-players:merged' });
  const counts = createMemo(() => filterCounts(players()), { name: 'server-players:counts' });
  const shown = createMemo(() => filterPlayers(players(), filter(), query()), { name: 'server-players:shown' });
  const currentPage = () => Math.min(page(), Math.max(0, Math.ceil(shown().length / PLAYER_PAGE_SIZE) - 1));
  const loading = () => whitelist.loading() || ops.loading() || bans.loading();
  const listError = () => whitelist.error() ?? ops.error() ?? bans.error();
  /** Whitelist on/off from server.properties, when this role can see it. */
  const whitelistOn = () => {
    const file = properties.value();
    if (!file) return null;
    return effectiveValue(propertyDef('white-list')!, parseProperties(file.values).typed) === true;
  };
  const dateText = (ms: number) => formatDate(ms, { dateStyle: 'medium' });
  const ask = (request: Request) => setDialog(request);

  return (
    <SettingsPage>
      <Show when={whitelistOn() !== null}>
        <div data-vesta="server-callout" data-tone={whitelistOn() ? 'success' : 'neutral'} data-server-whitelist-status>
          <Icon name={whitelistOn() ? 'icons/security/shield-check' : 'icons/security/shield-off'} size={16} />
          <span>{whitelistOn() ? t('servers.people.whitelist-on') : t('servers.people.whitelist-off')}</span>
          <span data-vesta="server-toolbar-spacer" />
          <SectionLink section="game">{t('servers.people.whitelist-change')}</SectionLink>
        </div>
      </Show>
      <div data-vesta="server-settings-bar">
        <SegmentedControl
          size="md"
          aria-label={t('servers.tab.players')}
          value={filter()}
          onChange={(value) => { setFilter(value as PlayerFilter); setPage(0); }}
          options={PLAYER_FILTERS.map((entry) => ({ value: entry, label: entry === 'all' ? t(filterLabels[entry]) : `${t(filterLabels[entry])} ${counts()[entry]}` }))}
        />
        <SettingsSearch value={query()} onChange={(value) => { setQuery(value); setPage(0); }} placeholder={t('servers.people.search')} />
        <Show when={moderate() || operator()}>
          <Button size="md" tone="accent" icon={<Icon name="icons/actions/add" />} disabled={addChoices().length === 0} onClick={() => ask({ action: addChoices()[0]!, player: '', choices: addChoices() })}>
            {t('servers.people.add')}
          </Button>
        </Show>
      </div>
      <ServerErrorNote error={listError()} onRetry={() => { void whitelist.refresh(); void ops.refresh(); void bans.refresh(); }} />

      <Show when={!loading() || players().length > 0} fallback={<EmptyLine role="status">{t('servers.loading')}</EmptyLine>}>
        <Show
          when={players().length > 0}
          fallback={
            <EmptyState variant="inline" icon="icons/content/people" title={t('servers.people.empty-title')} description={t('servers.people.empty-description')} />
          }
        >
          <Show when={shown().length > 0} fallback={<EmptyLine role="status">{query().trim() ? t('servers.people.no-match') : t('servers.people.filter-empty')}</EmptyLine>}>
            <ul data-vesta="server-player-list">
              <For each={playerPage(shown(), page())}>
                {(player) => (
                  <PlayerRow
                    player={player}
                    open={expanded() === player.key}
                    onToggle={() => setExpanded((current) => (current === player.key ? null : player.key))}
                    chips={playerChips(player, dateText)}
                    canAct={canAct}
                    onAction={(action) => ask({ action, player: player.name })}
                    date={dateText}
                  />
                )}
              </For>
            </ul>
            <Show when={shown().length > PLAYER_PAGE_SIZE}>
              <div data-vesta="server-settings-bar">
                <Button disabled={currentPage() === 0} onClick={() => setPage(Math.max(0, currentPage() - 1))}>{t('servers.people.previous-page')}</Button>
                <span role="status">{currentPage() + 1} / {Math.ceil(shown().length / PLAYER_PAGE_SIZE)}</span>
                <Button disabled={(currentPage() + 1) * PLAYER_PAGE_SIZE >= shown().length} onClick={() => setPage(currentPage() + 1)}>{t('servers.people.next-page')}</Button>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>

      <Show when={dialog()} keyed>
        {(request) => <ModerationDialog snapshot={props.snapshot} request={request} onClose={() => setDialog(null)} onDone={() => invalidateServerResources(id(), PLAYER_LIST_RESOURCES)} />}
      </Show>
    </SettingsPage>
  );

  function addChoices(): Action[] {
    return (['whitelist_add', 'op', 'ban'] as const).filter((action) => canAct(action));
  }
}

function PlayerRow(props: {
  player: KnownPlayer;
  open: boolean;
  onToggle: () => void;
  chips: ReturnType<typeof playerChips>;
  canAct: (action: Action) => boolean;
  onAction: (action: Action) => void;
  date: (ms: number) => string;
}) {
  const ban = () => props.player.ban;
  const expiry = () => (ban() ? banExpiry(ban()!.expires) : null);
  const created = () => { const value = ban() ? banExpiry(ban()!.created) : null; return value && !value.permanent ? props.date(value.atMs) : null; };
  return (
    <li data-vesta="server-player" data-open={props.open ? '' : undefined}>
      <button type="button" data-vesta="server-player-row" aria-expanded={props.open ? 'true' : 'false'} onClick={() => props.onToggle()}>
        <span data-vesta="server-activity-avatar" data-online={props.player.online ? '' : undefined} aria-hidden="true">{props.player.name.slice(0, 1).toUpperCase()}</span>
        <span data-vesta="server-player-name">
          <strong>{props.player.name}</strong>
          <Show when={props.player.uuid}>{(uuid) => <small><Sensitive label={t('servers.people.uuid')}>{shortUuid(uuid())}</Sensitive></small>}</Show>
        </span>
        <span data-vesta="server-player-chips">
          <For each={props.chips}>{(chip) => <Badge size="sm" variant="soft" tone={chip.tone}>{t(chip.message, chip.args)}</Badge>}</For>
        </span>
        <Icon name="icons/controls/chevron-right" size={14} />
      </button>
      <Show when={props.open}>
        <div data-vesta="server-player-detail">
          <div data-vesta="server-player-uuid">
            <span>{t('servers.people.uuid')}</span>
            <Show when={props.player.uuid} fallback={<span>{t('servers.people.no-uuid')}</span>}>
              {(uuid) => <CopyValue value={uuid()} label={t('servers.people.copy-uuid')}><Sensitive label={t('servers.people.uuid')}>{uuid()}</Sensitive></CopyValue>}
            </Show>
          </div>
          <div data-vesta="server-player-facts">
            <div data-vesta="server-player-fact">
              <span>{t('servers.people.whitelist-section')}</span>
              <p>{props.player.whitelisted ? t('servers.people.on-whitelist') : t('servers.people.not-on-whitelist')}</p>
              <Button size="sm" variant="outline" disabled={!props.canAct(props.player.whitelisted ? 'whitelist_remove' : 'whitelist_add')}
                onClick={() => props.onAction(props.player.whitelisted ? 'whitelist_remove' : 'whitelist_add')}>
                {props.player.whitelisted ? t('servers.moderate.whitelist-remove') : t('servers.players.add-whitelist')}
              </Button>
            </div>
            <div data-vesta="server-player-fact">
              <span>{t('servers.people.operator-section')}</span>
              <Show when={props.player.operator} fallback={<p>{t('servers.people.not-operator')}</p>}>
                {(op) => (
                  <p>
                    {t('servers.people.operator-level', { count: op().level })}
                    <small>{t('servers.people.operator-level-help')}{op().bypassesPlayerLimit ? ` ${t('servers.people.bypass')}` : ''}</small>
                  </p>
                )}
              </Show>
              <Button size="sm" variant="outline" disabled={!props.canAct(props.player.operator ? 'deop' : 'op')} onClick={() => props.onAction(props.player.operator ? 'deop' : 'op')}>
                {props.player.operator ? t('servers.moderate.deop') : t('servers.players.make-operator')}
              </Button>
            </div>
            <div data-vesta="server-player-fact" data-tone={ban() ? 'danger' : undefined}>
              <span>{t('servers.people.ban-section')}</span>
              <Show when={ban()} fallback={<p>{t('servers.people.not-banned')}</p>}>
                {(entry) => (
                  <p>
                    {entry().reason || t('servers.people.no-reason')}
                    <small>
                      <Metadata parts={[
                        entry().source ? t('servers.people.ban-by', { name: entry().source }) : null,
                        created() ? t('servers.people.ban-since', { time: created()! }) : null,
                        expiry() && !expiry()!.permanent ? t('servers.people.ban-ends', { time: props.date((expiry() as { atMs: number }).atMs) }) : t('servers.people.ban-permanent'),
                      ]} />
                    </small>
                  </p>
                )}
              </Show>
              <Button size="sm" variant="outline" tone={ban() ? undefined : 'danger'} disabled={!props.canAct(ban() ? 'pardon' : 'ban')} onClick={() => props.onAction(ban() ? 'pardon' : 'ban')}>
                {ban() ? t('servers.people.unban') : t('servers.people.ban')}
              </Button>
            </div>
          </div>
          <Show when={props.player.online}>
            <div>
              <Button size="sm" variant="ghost" disabled={!props.canAct('kick')} onClick={() => props.onAction('kick')}>{t('servers.people.kick')}</Button>
            </div>
          </Show>
        </div>
      </Show>
    </li>
  );
}

const actionTitles: Record<Action, MessageId> = {
  kick: 'servers.moderate.kick', ban: 'servers.people.ban', pardon: 'servers.people.unban',
  whitelist_add: 'servers.players.add-whitelist', whitelist_remove: 'servers.moderate.whitelist-remove',
  op: 'servers.players.make-operator', deop: 'servers.moderate.deop', kill: 'servers.moderate.kill', lightning: 'servers.moderate.lightning',
};
const choiceLabels: Partial<Record<Action, MessageId>> = {
  whitelist_add: 'servers.people.add-whitelist-choice', op: 'servers.people.add-operator-choice', ban: 'servers.people.add-ban-choice',
};

/** Every moderation change, with the server's confirmation step for operators. */
function ModerationDialog(props: {
  snapshot: ServerSnapshot;
  /** Each request mounts a fresh dialog, so its fields start from the request. */
  request: Request;
  onClose: () => void;
  /** After an accepted change: reread the lists it touches. */
  onDone: () => void;
}) {
  const now = useServersClock();
  const [action, setAction] = createSignal<Action>(untrack(() => props.request.action), { name: 'server-moderate:action' });
  const [player, setPlayer] = createSignal(untrack(() => props.request.player), { name: 'server-moderate:player' });
  const [reason, setReason] = createSignal('', { name: 'server-moderate:reason' });
  const [duration, setDuration] = createSignal('permanent', { name: 'server-moderate:duration' });
  const [busy, setBusy] = createSignal(false, { name: 'server-moderate:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-moderate:error' });
  /** The request as first sent; frozen while it may have arrived or awaits confirmation. */
  const [attempt, setAttempt] = createSignal<Attempt | null>(null, { name: 'server-moderate:attempt' });
  const confirm = () => attempt()?.confirm;
  const remaining = () => Math.max(0, Math.ceil(((confirm()?.expiresAtMs ?? 0) - now()) / 1000));
  /** The confirmation step still stands: within its countdown, or its answer was lost. */
  const confirming = () => !!confirm() && (remaining() > 0 || !!confirm()!.uncertain);
  const locked = () => busy() || !!standing(attempt(), now());
  const uncertain = () => !!attempt()?.uncertain || !!confirm()?.uncertain;
  const takesReason = () => action() === 'kick' || action() === 'ban';
  const adding = () => !props.request.player && (props.request.choices?.length ?? 0) > 1;

  /** A fresh attempt from the fields, routed by the server's state right now. */
  const fresh = async (id: string): Promise<Attempt | null> => {
    const status = props.snapshot.status;
    const routed = routeFor(action(), { state: status?.state, generation: status?.generation });
    if (!routed || !isPlayerName(player())) return null;
    const base: Attempt = {
      action: action(), player: player(), reason: reason(), durationSeconds: duration() === 'permanent' ? null : Number(duration()),
      ...routed, intentId: newIntentId(), uncertain: false,
    };
    // Reading the file revision sends nothing; a failure here leaves no attempt behind.
    if (routed.route === 'offline') base.expected = (await serverCommand((client) => client.offlineWhitelist(id))).sha256;
    return base;
  };

  const submit = async () => {
    if (busy()) return;
    const id = props.snapshot.connection.id;
    setBusy(true); setError(null);
    let current: Attempt | null = standing(attempt(), now());
    try {
      current ??= await fresh(id);
      if (!current) return;
      setAttempt(current);
      const add = current.action === 'whitelist_add';
      if (current.confirm) {
        const ticket = current.confirm.intentId;
        const operation = await serverCommand((client) => client.moderateConfirm(id, ticket));
        putOperations(id, [{ ...operation, intent: operation.intent ?? 'players.moderate' }]);
      } else if (current.route === 'offline') {
        const { player: name, expected, intentId } = current;
        await serverCommand((client) => client.offlineWhitelistUpdate(id, name, add, expected ?? null, intentId));
      } else if (current.route === 'desired') {
        const { player: name, generation, intentId } = current;
        await serverCommand((client) => client.startupWhitelistUpdate(id, name, add, generation!, intentId));
      } else {
        const request = moderationRequest(current);
        const { generation, intentId } = current;
        const result = await serverCommand((client) => client.moderate(id, request, generation!, intentId));
        if (result.kind === 'awaitingConfirmation') {
          setAttempt({ ...current, uncertain: false, confirm: { intentId, expiresAtMs: result.expiresAtMs, player: request.player, uncertain: false } });
          return;
        }
        putOperations(id, [{ ...result.operation, intent: result.operation.intent ?? 'players.moderate' }]);
      }
      setAttempt(null);
      toast.show({ title: t('servers.moderate.accepted'), tone: 'neutral' });
      props.onDone();
      props.onClose();
    } catch (reason) {
      const failure = reason as ServerCommandError;
      setAttempt(current ? afterFailure(current, failure.code, now()) : null);
      setError(failure);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      title={adding() ? t('servers.people.add-title') : t(actionTitles[action()])}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button tone={action() === 'ban' || action() === 'op' ? 'danger' : 'accent'} disabled={busy() || !isPlayerName(player())} onClick={() => void submit()}>
            {confirming() ? t('servers.moderate.confirm', { count: remaining() }) : t(actionTitles[action()])}
          </Button>
        </>
      }
    >
      <Show when={adding()}>
        <SegmentedControl size="md" fill aria-label={t('servers.people.add-as')} value={action()} disabled={locked()}
          onChange={(value) => setAction(value as Action)}
          options={(props.request.choices ?? []).map((choice) => ({ value: choice, label: t(choiceLabels[choice] ?? actionTitles[choice]) }))} />
      </Show>
      <TextField
        label={t('servers.players.name')}
        value={player()}
        onChange={setPlayer}
        readOnly={!!props.request.player || locked()}
        autofocus={!props.request.player}
        error={player() && !isPlayerName(player()) ? t('servers.players.name-format') : undefined}
        spellcheck="false"
      />
      <Show when={takesReason()}>
        <TextField label={t('servers.moderate.reason')} value={reason()} onChange={setReason} readOnly={locked()} maxlength={256} />
      </Show>
      <Show when={action() === 'ban'}>
        <Select label={t('servers.moderate.duration')} value={duration()} onChange={setDuration} disabled={locked()}
          options={BAN_DURATIONS.map((seconds) => ({
            value: seconds === null ? 'permanent' : String(seconds),
            label: seconds === null ? t('servers.people.ban-permanent') : t(banDuration(seconds).message, { count: banDuration(seconds).count }),
          }))} />
      </Show>
      <Show when={action() === 'op'}>
        <p data-vesta="server-callout" data-tone="warning">{t('servers.moderate.op-warning')}</p>
      </Show>
      <Show when={confirming() ? confirm() : undefined}>
        {(pending) => <p data-vesta="server-callout" data-tone="warning">{t('servers.moderate.confirm-target', { name: pending().player })}</p>}
      </Show>
      <Show when={uncertain()}>
        <p data-vesta="server-muted" role="status">{t('servers.operation.uncertain-retry')}</p>
      </Show>
      <p data-vesta="server-muted">{t('servers.moderate.delivery-note')}</p>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}

/** Kept for prefetch and checks that name the Players section's lists. */
export const PLAYER_SECTION_LISTS = [whitelistResource, operatorsResource, bansResource] as const;
export { IconButton as _PlayersIconButton };
