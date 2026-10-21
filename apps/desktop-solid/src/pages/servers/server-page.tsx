import { Button, Dialog, IconButton, Menu, MenuItem, MenuSeparator, Tab, TabList, TabPanel, Tabs, Badge, toast } from '@vesta/ui';
import { For, Show, createSignal, onCleanup, onSettled, untrack, type Component } from 'solid-js';
import { isServer } from '@solidjs/web';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { anyVisible } from '../../features/servers/capabilities';
import { errorMessage } from '../../features/servers/errors';
import { IntentMemo, connectionFact, lifecycleControls, minecraftFactNow, newIntentId, playersFact, readinessReasonMessage, statusDot, supervisorWarnings, type LifecycleAction } from '../../features/servers/model';
import { initials, serverArt } from '../../features/servers/art';
import { RemoveServerDialog } from './remove-dialog';
import { Dynamic } from '@solidjs/web';
import { busyIntent } from '../../features/servers/operations-model';
import { loadOperations, putOperations, putSnapshot, removeServer, serverCommand, serverOperations, serverSnapshot, serversLoaded, updateServer, useServerTopic, useServersClock } from '../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../features/servers/native';
import { ActivityTab } from './tabs/activity-tab';
import { ConnectionTab } from './tabs/connection-tab';
import { ConsoleTab } from './tabs/console-tab';
import { OverviewTab } from './tabs/overview-tab';
import { PlayersTab } from './tabs/players-tab';
import { FilesTab } from './tabs/files-tab';
import { PropertiesTab } from './tabs/properties-tab';
import { FingerprintView, Sensitive, ServerErrorNote, StatusDot } from './parts';
import '../library/instance/instance-header.css';
import '../library/instance/instance-page.css';

interface TabDef {
  id: string;
  label: MessageId;
  icon: string;
  /** Shown unless every listed capability is known to be absent. Empty means always. */
  needs: string[];
  flush?: boolean;
  view: Component<{ snapshot: ServerSnapshot }>;
}

const tabs: TabDef[] = [
  { id: 'overview', label: 'servers.tab.overview', icon: 'icons/navigation/home', needs: [], view: OverviewTab },
  { id: 'console', label: 'servers.tab.console', icon: 'icons/content/terminal', needs: ['console.read'], flush: true, view: ConsoleTab },
  { id: 'players', label: 'servers.tab.players', icon: 'icons/content/chat', needs: ['players.view'], view: PlayersTab },
  { id: 'files', label: 'server-files.tab', icon: 'icons/content/folder', needs: ['files.list'], flush: true, view: FilesTab },
  { id: 'settings', label: 'server-settings.tab', icon: 'icons/content/gear', needs: ['config.view'], flush: true, view: PropertiesTab },
  { id: 'activity', label: 'servers.tab.activity', icon: 'icons/content/history', needs: ['tasks.view'], flush: true, view: ActivityTab },
  { id: 'connection', label: 'servers.tab.connection', icon: 'icons/security/network', needs: [], flush: true, view: ConnectionTab },
];

const sideNavQuery = '(min-width: 960px)';
function useSideNav() {
  if (isServer) return () => false;
  const media = matchMedia(sideNavQuery);
  const [wide, setWide] = createSignal(media.matches, { name: 'servers:side-nav' });
  const change = () => setWide(media.matches);
  media.addEventListener('change', change);
  onCleanup(() => media.removeEventListener('change', change));
  return wide;
}

export function ServerWorkspace(props: { id: string }) {
  return (
    <Show
      when={serverSnapshot(props.id)}
      fallback={
        <Board>
          <Show when={serversLoaded()}>
            <EmptyState icon="icons/rail/servers" title={t('servers.not-found')}>
              <Button onClick={() => transitionTo('/servers')}>{t('servers.done.all-servers')}</Button>
            </EmptyState>
          </Show>
        </Board>
      }
    >
      <ServerContent id={props.id} />
    </Show>
  );
}

function ServerContent(props: { id: string }) {
  // One status subscription per open workspace; native code shares the stream.
  useServerTopic(() => props.id, 'status');
  useServerTopic(() => props.id, 'operations');
  // One bounded read of recent tasks when the workspace opens; the topic keeps it current.
  onSettled(() => {
    if (anyVisible(untrack(snapshot).capabilities, ['tasks.view'])) void loadOperations(props.id).catch(() => {});
  });
  const sideNav = useSideNav();
  const snapshot = () => serverSnapshot(props.id)!;
  const visible = () => tabs.filter((tab) => anyVisible(snapshot().capabilities, tab.needs) || !tab.needs.length);
  const active = () => (visible().some((tab) => tab.id === route().detail) ? route().detail! : 'overview');
  const open = (tab: string) => transitionTo(tab === 'overview' ? `/servers/${props.id}` : `/servers/${props.id}/${tab}`);
  const blocked = () => snapshot().state.access === 'fingerprint_changed' || snapshot().state.access === 'credentials_rejected';

  return (
    <Board fixed class="instance-board servers-workspace">
      <div data-vesta="instance-layout">
        <ServerHeader snapshot={snapshot()} />
        <Show
          when={!blocked()}
          fallback={
            <div class="instance-pane">
              <Show when={snapshot().state.access === 'fingerprint_changed'} fallback={<CredentialsRejected snapshot={snapshot()} />}>
                <TrustChanged snapshot={snapshot()} />
              </Show>
            </div>
          }
        >
          <Tabs size="sm" orientation={sideNav() ? 'vertical' : 'horizontal'} value={active()} onChange={open} class="instance-tabs">
            <TabList aria-label={t('servers.sections')}>
              <For each={visible()}>
                {(tab) => (
                  <Tab value={tab.id} icon={<Icon name={tab.icon} />}
                    badge={tab.id === 'overview' && snapshot().restartRequired ? <Badge size="sm" tone="warning">!</Badge> : undefined}
                  >{t(tab.label)}</Tab>
                )}
              </For>
            </TabList>
            <For each={visible()}>
              {(tab) => (
                <Show when={active() === tab.id}>
                  <TabPanel forceMount value={tab.id} class={tab.flush ? 'instance-pane instance-pane-flush' : 'instance-pane'}>
                    <Dynamic component={tab.view} snapshot={snapshot()} />
                  </TabPanel>
                </Show>
              )}
            </For>
          </Tabs>
        </Show>
        <Show when={snapshot().restartRequired && !blocked()}>
          <PendingRestart />
        </Show>
      </div>
    </Board>
  );
}

/** The instance header's layout: art banner, icon tile, title and meta, then actions. */
function ServerHeader(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const [removing, setRemoving] = createSignal(false, { name: 'server-header:removing' });
  const art = () => serverArt(props.snapshot.connection.serverId || props.snapshot.connection.id);
  const minecraft = () => minecraftFactNow(props.snapshot, now());
  const connection = () => connectionFact(props.snapshot, now());
  const notice = () => headerNotice(props.snapshot, now());
  const id = () => props.snapshot.connection.id;
  return (
    <header data-vesta="instance-header" data-server-header style={{ '--header-image': `url("${art()}")` } as never}>
      <div data-vesta="instance-header-art" aria-hidden="true" />
      <div data-vesta="instance-header-main">
        <img data-vesta="instance-header-icon" src={serverArt(props.snapshot.connection.serverId || id(), initials(props.snapshot.connection.name))} alt="" draggable="false" />
        <div data-vesta="instance-header-copy">
          <h1 data-vesta="instance-header-title">{props.snapshot.connection.name}</h1>
          <p data-vesta="instance-header-meta">
            <span data-vesta="server-header-state" data-tone={minecraft().tone}>
              <StatusDot dot={statusDot(props.snapshot)} />
              {t(minecraft().message, minecraft().args)}
              <Show when={minecraft().seen}>{(seen) => <> · {t('servers.seen', { time: t(seen().message, { count: seen().count }) })}</>}</Show>
            </span>
            <Show when={props.snapshot.info?.minecraftVersion}>{(version) => <span>{version()}</span>}</Show>
            <Show when={props.snapshot.status?.state === 'running'}>
              <span>{t(playersFact(props.snapshot.status, now()).message, playersFact(props.snapshot.status, now()).args)}</span>
            </Show>
            <span><Sensitive>{props.snapshot.connection.endpoint}</Sensitive></span>
            <Show when={props.snapshot.state.phase !== 'online'}>
              <span>{t(connection().message, connection().args)}</span>
            </Show>
          </p>
        </div>
        <div data-vesta="instance-header-actions">
          <IconButton
            variant="ghost"
            label={t('servers.tab.connection')}
            icon={<Icon name="icons/content/gear" />}
            onClick={() => transitionTo(`/servers/${id()}/connection`)}
          />
          <Menu
            placement="bottom-end"
            trigger={(menuProps) => (
              <IconButton {...menuProps} variant="ghost" label={t('servers.actions')} tooltip={false} icon={<Icon name="icons/content/ellipsis-v" />} />
            )}
          >
            <MenuItem onSelect={() => transitionTo(`/servers/${id()}/console`)}>{t('servers.tab.console')}</MenuItem>
            <MenuItem onSelect={() => void navigator.clipboard?.writeText(props.snapshot.connection.endpoint)}>{t('servers.copy-address')}</MenuItem>
            <MenuItem onSelect={() => void updateServer(id(), { pinned: !props.snapshot.connection.pinned })}>
              {props.snapshot.connection.pinned ? t('common.unpin') : t('servers.pin')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => setRemoving(true)}>{t('servers.remove')}</MenuItem>
          </Menu>
          <LifecycleBar snapshot={props.snapshot} />
        </div>
      </div>
      <Show when={notice()}>
        {(current) => (
          <div data-vesta="instance-notice" data-tone={current().tone} role={current().tone === 'danger' ? 'alert' : 'status'}>
            <Icon name={current().tone === 'danger' ? 'icons/status/error' : 'icons/controls/warning'} size={14} />
            <p><strong>{current().title}</strong><Show when={current().text}><span>{current().text}</span></Show></p>
          </div>
        )}
      </Show>
      <RemoveServerDialog snapshot={props.snapshot} open={removing()} onOpenChange={setRemoving} />
    </header>
  );
}

/** One strip under the header for the most important problem, like the instance crash notice. */
function headerNotice(snapshot: ServerSnapshot, now: number): { tone: 'danger' | 'warning'; title: string; text?: string } | null {
  const status = snapshot.status;
  if (status?.lifecycle === 'crash_loop' || status?.supervisor?.crashLoop) return { tone: 'danger', title: t('servers.minecraft.crash-loop'), text: t('servers.notice.crash-loop') };
  if (status?.lifecycle === 'recovery_required') return { tone: 'danger', title: t('servers.minecraft.recovery-required'), text: t('servers.notice.recovery') };
  if (snapshot.state.phase === 'unreachable' || snapshot.state.phase === 'backoff') {
    const connection = connectionFact(snapshot, now);
    return { tone: 'warning', title: t(connection.message, connection.args), text: t('servers.notice.last-known') };
  }
  const warnings = supervisorWarnings(status ?? null);
  if (status?.readinessReason) return { tone: 'warning', title: t('servers.minecraft.degraded'), text: t(readinessReasonMessage[status.readinessReason]) };
  if (warnings.length) return { tone: 'warning', title: t('servers.notice.limited-control'), text: t(warnings[0]!) };
  return null;
}

const actionLabels: Record<LifecycleAction, MessageId> = {
  start: 'servers.lifecycle.start',
  stop: 'servers.lifecycle.stop',
  restart: 'servers.lifecycle.restart',
  kill: 'servers.lifecycle.kill',
};

/** Start / Stop / Restart, with Force kill replacing Stop while a stop is pending. */
export function LifecycleBar(props: { snapshot: ServerSnapshot }) {
  const [busy, setBusy] = createSignal<LifecycleAction | null>(null);
  const [killOpen, setKillOpen] = createSignal(false);
  const controls = () => lifecycleControls(props.snapshot);
  const id = () => props.snapshot.connection.id;
  const pending = (action: LifecycleAction) => busyIntent(serverOperations(id()), `lifecycle.${action}`);
  // Retrying the same action on the same run after an uncertain outcome reuses its intent.
  const intents = new IntentMemo();
  const [uncertain, setUncertain] = createSignal(false, { name: 'server-lifecycle:uncertain' });

  const submit = async (action: Exclude<LifecycleAction, 'kill'>) => {
    const generation = props.snapshot.status?.generation ?? null;
    const intentId = intents.idFor({ action, generation });
    setBusy(action);
    try {
      const operation = await serverCommand((client) => client.lifecycle(id(), action, generation, intentId));
      intents.settle();
      putOperations(id(), [{ ...operation, intent: operation.intent ?? `lifecycle.${action}` }]);
      toast.show({ title: t('servers.operation.accepted-toast', { name: t(actionLabels[action]) }), tone: 'neutral' });
    } catch (reason) {
      const error = reason as ServerCommandError;
      intents.settle(error);
      toast.show({ title: t(errorMessage(error)), tone: error.code === 'stale_target' ? 'warning' : 'danger' });
      if (error.code === 'stale_target') void serverCommand((client) => client.snapshot(id(), true)).then(putSnapshot).catch(() => {});
    } finally {
      setUncertain(intents.uncertain);
      setBusy(null);
    }
  };

  return (
    <div data-vesta="server-lifecycle">
      <Show when={controls().blocked && !controls().primary}>
        <span data-vesta="server-lifecycle-note">{t(controls().blocked!)}</span>
      </Show>
      <Show when={uncertain()}>
        <span data-vesta="server-lifecycle-note" role="status">{t('servers.operation.uncertain-retry')}</span>
      </Show>
      <Show when={controls().restart}>
        <Button variant="outline" icon={<Icon name="icons/actions/reload" />} disabled={!!busy() || pending('restart')} onClick={() => void submit('restart')}>
          {t('servers.lifecycle.restart')}
        </Button>
      </Show>
      <Show when={controls().primary}>
        {(primary) => (
          <Show
            when={primary() === 'kill'}
            fallback={
              <Button
                tone={primary() === 'start' ? 'accent' : 'neutral'}
                icon={<Icon name={primary() === 'start' ? 'icons/actions/play' : 'icons/actions/stop'} />}
                disabled={!!busy() || pending(primary())}
                onClick={() => void submit(primary() as 'start' | 'stop')}
              >
                {busy() === primary() ? t('servers.lifecycle.sending') : t(actionLabels[primary()])}
              </Button>
            }
          >
            <Button tone="danger" icon={<Icon name="icons/actions/stop" />} onClick={() => setKillOpen(true)}>{t('servers.lifecycle.kill')}</Button>
          </Show>
        )}
      </Show>
      <KillDialog open={killOpen()} onOpenChange={setKillOpen} snapshot={props.snapshot} />
    </div>
  );
}

/** Two-step force kill bound to the exact generation, with the server's expiry. */
function KillDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const [prepared, setPrepared] = createSignal<{ intentId: string; expiresAtMs: number; generation: string } | null>(null);
  const [error, setError] = createSignal<ServerCommandError | null>(null);
  const [busy, setBusy] = createSignal(false);
  const generation = () => props.snapshot.status?.generation ?? null;
  /** The kill only applies to the run it was prepared for, while that run is still stopping. */
  const stillStopping = () => {
    const status = props.snapshot.status;
    const target = prepared()?.generation ?? generation();
    return !!status && (status.state === 'stopping' || status.state === 'draining') && !!target && status.generation === target;
  };
  const remaining = () => Math.max(0, Math.ceil(((prepared()?.expiresAtMs ?? 0) - now()) / 1000));
  const expired = () => !!prepared() && remaining() === 0;
  const id = () => props.snapshot.connection.id;

  const prepare = async () => {
    const target = generation();
    if (!target) return;
    setBusy(true); setError(null);
    try {
      const intentId = newIntentId();
      const result = await serverCommand((client) => client.killPrepare(id(), target, intentId));
      setPrepared({ intentId, expiresAtMs: result.expiresAtMs, generation: target });
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    const current = prepared();
    if (!current) return;
    setBusy(true); setError(null);
    try {
      const operation = await serverCommand((client) => client.killConfirm(id(), current.intentId));
      putOperations(id(), [{ ...operation, intent: operation.intent ?? 'lifecycle.kill' }]);
      setPrepared(null);
      props.onOpenChange(false);
    } catch (reason) {
      setError(reason as ServerCommandError);
      if ((reason as ServerCommandError).code === 'confirmation_expired') setPrepared(null);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) { setPrepared(null); setError(null); } props.onOpenChange(open); }}
      title={t('servers.kill.title')}
      description={t('servers.kill.description')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>{stillStopping() ? t('common.cancel') : t('nav.close')}</Button>
          <Show when={stillStopping()}>
          <Show
            when={prepared() && !expired()}
            fallback={<Button tone="danger" variant="outline" disabled={busy() || !generation()} onClick={() => void prepare()}>{t(expired() ? 'servers.kill.prepare-again' : 'servers.kill.prepare')}</Button>}
          >
            <Button tone="danger" disabled={busy()} onClick={() => void confirm()}>{t('servers.kill.confirm', { count: remaining() })}</Button>
          </Show>
          </Show>
        </>
      }
    >
      <dl data-vesta="server-add-facts">
        <dt>{t('servers.kill.target')}</dt>
        <dd><code>{(prepared()?.generation ?? generation() ?? '').slice(0, 12)}</code></dd>
      </dl>
      <Show
        when={stillStopping()}
        fallback={<p data-vesta="server-callout" data-tone="success" role="status">{t('servers.kill.no-longer-needed')}</p>}
      >
        <p data-vesta="server-callout" data-tone="warning">{t('servers.kill.warning')}</p>
      </Show>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}

function PendingRestart() {
  return (
    <div data-vesta="server-pending" role="status">
      <Icon name="icons/controls/warning" />
      <span>{t('servers.pending.restart-required')}</span>
    </div>
  );
}

/** Management pauses until the user compares the new fingerprint. */
function TrustChanged(props: { snapshot: ServerSnapshot }) {
  const [presented, setPresented] = createSignal<string | null>(null);
  const [error, setError] = createSignal<ServerCommandError | null>(null);
  const check = async () => {
    setError(null);
    try {
      const found = await serverCommand((client) => client.discover(props.snapshot.connection.endpoint));
      setPresented(found.fingerprint);
    } catch (reason) { setError(reason as ServerCommandError); }
  };
  const approve = async () => {
    const value = presented();
    if (!value) return;
    try { putSnapshot(await serverCommand((client) => client.approveFingerprint(props.snapshot.connection.id, value))); }
    catch (reason) { setError(reason as ServerCommandError); }
  };
  return (
    <div data-vesta="server-blocking" role="alert">
      <Icon name="icons/security/shield-off" size={28} />
      <h2>{t('servers.trust.changed-title')}</h2>
      <p>{t('servers.trust.changed-description')}</p>
      <h3>{t('servers.trust.approved')}</h3>
      <FingerprintView value={props.snapshot.connection.fingerprint} />
      <Show when={presented()}>
        {(value) => (<><h3>{t('servers.trust.presented')}</h3><FingerprintView value={value()} /></>)}
      </Show>
      <ServerErrorNote error={error()} />
      <footer>
        <Button variant="ghost" onClick={() => void removeServer(props.snapshot.connection.id).then(() => transitionTo('/servers'))}>{t('servers.remove')}</Button>
        <Show when={presented()} fallback={<Button onClick={() => void check()}>{t('servers.trust.check')}</Button>}>
          <Button tone="danger" onClick={() => void approve()}>{t('servers.trust.approve')}</Button>
        </Show>
      </footer>
    </div>
  );
}

function CredentialsRejected(props: { snapshot: ServerSnapshot }) {
  return (
    <div data-vesta="server-blocking" role="alert">
      <Icon name="icons/security/lock" size={28} />
      <h2>{t('servers.rejected.title')}</h2>
      <p>{t('servers.error.credentials-rejected')}</p>
      <footer>
        <Button variant="ghost" onClick={() => void removeServer(props.snapshot.connection.id).then(() => transitionTo('/servers'))}>{t('servers.remove')}</Button>
        <Button onClick={() => transitionTo('/servers/add')}>{t('servers.rejected.pair-again')}</Button>
      </footer>
    </div>
  );
}
