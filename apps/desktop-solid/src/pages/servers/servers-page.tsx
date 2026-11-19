import { Button, IconButton } from '@vesta/ui';
import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { refreshServers, serverSnapshot, serverSnapshots, serversListError, serversLoaded, useServersClock } from '../../features/servers/store';
import { AddServer } from './add-server';
import { HostGuide } from './onboarding';
import { addRoute } from '../../features/servers/onboarding-model';
import { groupServers } from '../../features/servers/host-model';
import { serverArt } from '../../features/servers/art';
import { addConnectionId, clearAdd, hostReach, hosts, serverAddJob, serverAddJobs, vestaHost, type AddTask } from '../../features/servers/hosts-store';
import type { VestaHost } from '../../features/servers/native-hosts';
import type { ServerSnapshot } from '../../features/servers/native';
import { HostAdd, ProgressStep } from './host-add';
import { HostSettings } from './host-settings';
import { ServerCard } from './server-card';
import { ServerWorkspace } from './server-page';
import { ServerErrorNote } from './parts';
import { VestaSetup } from './vesta-setup';
import { Reach } from './vesta-parts';
import '../library/library-page.css';
import './servers.css';
import './vesta-server.css';

/**
 * `/servers`, `/servers/setup` (also the old `/servers/add`), `/servers/add/<guide or connectionId>`,
 * `/servers/host/<hostId>[/add]` and `/servers/<connectionId>[/<tab>]`.
 */
export function ServersPage() {
  const section = () => route().section;
  return (
    <Show when={section() !== 'setup' && section() !== 'add'} fallback={<AddPage />}>
      <Show when={section() === 'host' ? route().detail : undefined} keyed fallback={
        <Show when={section() !== 'host' ? section() : undefined} keyed fallback={<ServerList />}>
          {(id) => <ServerDestination id={id} />}
        </Show>
      }>
        {(hostId) => (
          <Show when={route().item === 'add' || route().item === 'import'} fallback={<HostSettings hostId={hostId} />}>
            <HostAdd hostId={hostId} />
          </Show>
        )}
      </Show>
    </Show>
  );
}

/**
 * `/servers/setup` and `/servers/add` start by setting up a Vesta Server. The install guide,
 * connecting by address and re-pairing a saved connection keep their `/servers/add/<detail>` routes.
 */
function AddPage() {
  const target = () => addRoute(route().section === 'setup' ? undefined : route().detail);
  return (
    <Switch>
      <Match when={target().kind === 'start'}><VestaSetup /></Match>
      <Match when={target().kind === 'connect'}><AddServer /></Match>
      <Match when={target().kind === 'host'}><HostGuide /></Match>
      <Match when={(() => { const value = target(); return value.kind === 'reconnect' ? value.connectionId : undefined; })()} keyed>
        {(id) => <AddServer connectionId={id} />}
      </Match>
    </Switch>
  );
}

/**
 * The server grid, laid out exactly like the Library: cards, then an add tile. One machine
 * with no servers yet is a single calm empty state for that machine; machines only get their
 * own headings once there are two or more.
 */
function ServerList() {
  const now = useServersClock();
  const groups = createMemo(() => groupServers(serverSnapshots(), hosts()), { name: 'servers:groups' });
  const single = () => (hosts().length === 1 ? hosts()[0] : undefined);
  const empty = () => serverSnapshots().length === 0 && serverAddJobs().length === 0;
  return (
    <Board>
      <Show when={hosts().length > 0 && !(empty() && single())}>
        <header data-vesta="vesta-group-header" data-list-header>
          <Show when={single()}>
            {(host) => <Button size="sm" variant="ghost" icon={<Icon name="icons/rail/servers" />} onClick={() => transitionTo(`/servers/host/${host().id}`)}>
              {host().name}<Reach hostId={host().id} />
            </Button>}
          </Show>
          <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/add" />} onClick={() => transitionTo('/servers/setup')}>{t('vesta-server.list.set-up-another')}</Button>
        </header>
      </Show>
      <ServerErrorNote error={serversListError()} onRetry={() => void refreshServers()} />
      <Switch>
        <Match when={empty() && hosts().length === 0}>
          <Show when={serversLoaded()}>
            <EmptyState icon="icons/rail/servers" title={t('servers.empty-title')} description={t('vesta-server.list.empty-description')}>
              <Button tone="accent" icon={<Icon name="icons/actions/add" />} onClick={() => transitionTo('/servers/setup')}>{t('vesta-server.setup.title')}</Button>
            </EmptyState>
          </Show>
        </Match>
        <Match when={empty() && single()}>
          {(host) => <MachineEmpty host={host()} />}
        </Match>
        <Match when={true}>
          <For each={groups()} keyed={(group) => group.key}>
            {(group) => (
              <ServerGroup host={group().host} other={group().key === 'other'} servers={group().servers} now={now()}
                hostId={group().host?.id ?? single()?.id}
                addTo={group().host?.id ?? (group().key === 'all' ? single()?.id ?? null : undefined)} />
            )}
          </For>
        </Match>
      </Switch>
    </Board>
  );
}

/** One machine, no servers yet: the machine, whether it's online, and the one next step. */
function MachineEmpty(props: { host: VestaHost }) {
  return (
    <EmptyState icon="icons/rail/servers" title={props.host.name} status={<Reach hostId={props.host.id} />}
      description={t(hostReach(props.host.id) === 'offline' ? 'vesta-server.list.machine-offline' : 'vesta-server.list.machine-empty', { name: props.host.name })}>
      <Button tone="accent" icon={<Icon name="icons/actions/add" />} onClick={() => transitionTo(`/servers/host/${props.host.id}/add`)}>{t('vesta-server.list.add-first')}</Button>
      <Button variant="ghost" icon={<Icon name="icons/rail/settings" />} onClick={() => transitionTo(`/servers/host/${props.host.id}`)}>{t('vesta-server.list.machine-settings')}</Button>
    </EmptyState>
  );
}

/** Cards, then one add tile: add a server to this machine, or set up a new machine. */
function ServerGrid(props: { servers: ServerSnapshot[]; now: number; label: string; hostId?: string; addTo: string | null | undefined }) {
  return (
    <ul data-vesta="library-grid" aria-label={props.label}>
      <For each={props.servers.filter((snapshot) => !showAddJob(serverAddJob(snapshot.connection.id), true))} keyed={(snapshot) => snapshot.connection.id}>
        {(snapshot) => (
          <li>
            <div data-vesta="library-card-slot">
              <ServerCard snapshot={snapshot()} now={props.now} />
            </div>
          </li>
        )}
      </For>
      <For each={serverAddJobs().filter((task) => task.hostId === props.hostId && showAddJob(task, props.servers.some((s) => s.connection.id === addConnectionId(task))))}
        keyed={(task) => task.jobId}>
        {(task) => <li><div data-vesta="library-card-slot"><InstallingServerCard task={task()} /></div></li>}
      </For>
      <Show when={props.addTo !== undefined}>
        <li>
          <div data-vesta="library-card-slot">
            <button type="button" data-vesta="server-add-tile" onClick={() => transitionTo(props.addTo ? `/servers/host/${props.addTo}/add` : '/servers/setup')}>
              <Icon name="icons/actions/add" size={22} />
              <span>{props.addTo ? t('vesta-server.host.add-server') : t('vesta-server.setup.title')}</span>
            </button>
          </div>
        </li>
      </Show>
    </ul>
  );
}

function ServerGroup(props: { host: VestaHost | null; other: boolean; servers: ServerSnapshot[]; now: number; hostId?: string; addTo: string | null | undefined }) {
  const [expanded, setExpanded] = createSignal(true);
  const label = () => props.host?.name ?? t(props.other ? 'vesta-server.list.other' : 'servers.title');
  return (
    <section data-vesta="vesta-server-group" aria-label={label()}>
      <Show when={props.host} fallback={<Show when={props.other}><header data-vesta="vesta-group-header"><h2>{label()}</h2></header></Show>}>
        {(host) => <header data-vesta="vesta-group-header">
          <h2><Button size="sm" variant="ghost" aria-expanded={expanded() ? 'true' : 'false'}
            icon={<Icon name={expanded() ? 'icons/controls/chevron-down' : 'icons/controls/chevron-right'} size={14} />}
            onClick={() => setExpanded(!expanded())}>{label()}</Button></h2>
          <Reach hostId={host().id} />
          <IconButton size="sm" variant="ghost" label={t('vesta-server.list.settings', { name: label() })} icon={<Icon name="icons/rail/settings" />}
            onClick={() => transitionTo(`/servers/host/${host().id}`)} />
        </header>}
      </Show>
      <Show when={expanded()}><ServerGrid servers={props.servers} now={props.now} label={label()} hostId={props.hostId} addTo={props.addTo} /></Show>
    </section>
  );
}

function showAddJob(task: AddTask | undefined, registered: boolean) {
  if (!task || task.job?.state === 'cancelled') return false;
  return !registered || !task.job || ['applying', 'interrupted', 'starting'].includes(task.job.state) || task.job.state === 'ready' && task.mode !== 'import' && !task.job.error && !task.error;
}

function ServerDestination(props: { id: string }) {
  const job = () => serverAddJob(props.id);
  return (
    <Show when={showAddJob(job(), !!serverSnapshot(props.id)) && job()} fallback={<ServerWorkspace id={props.id} />}>
      {(task) => <Board class="servers-board"><div data-vesta="server-add" data-wide>
        <Show when={task().job} fallback={<p role="status">{t('instance.op.installing')}</p>}>
          <ProgressStep hostId={task().hostId} machine={vestaHost(task().hostId)?.name ?? task().hostId} task={task()}
            onStartOver={() => { clearAdd(task().hostId); transitionTo(`/servers/host/${task().hostId}/add`); }} />
        </Show>
      </div></Board>}
    </Show>
  );
}

function InstallingServerCard(props: { task: AddTask }) {
  const id = () => addConnectionId(props.task);
  const state = () => props.task.job?.state;
  const label = () => t(state() === 'online' || state() === 'ready' ? 'server-add.progress.view'
    : state() === 'starting' ? 'servers.card.starting'
    : state() === 'failed' || state() === 'interrupted' ? 'servers.card.attention' : 'instance.op.installing');
  return (
    <button type="button" data-vesta="instance-card" data-server-card data-add-card
      style={{ '--instance-card-image': `url("${serverArt(id() ?? props.task.name)}")` }}
      onClick={() => transitionTo(`/servers/${id()}`)}>
      <div data-vesta="instance-card-overlay" data-tone="neutral">
        <Show when={!state() || state() === 'applying' || state() === 'starting'}><span data-vesta="instance-card-spinner" aria-hidden="true" /></Show>
        <h3 data-vesta="instance-card-overlay-name">{props.task.name}</h3>
        <p data-vesta="instance-card-overlay-text">{label()}</p>
      </div>
    </button>
  );
}
