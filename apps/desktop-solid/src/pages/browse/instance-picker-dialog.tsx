import { Button, Dialog, TextField } from '@vesta/ui';
import { createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js';
import { EmptyLine } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { fetchInstalled, type InstalledRow } from '../../features/browse/browse-api';
import {
  projectCompatibility,
  projectKey,
  selectInstallVersion,
  updateAvailable,
  versionFit,
  type ResourceProject,
  type ResourceType,
  type ResourceVersion,
} from '../../features/browse/browse-model';
import { loadVersions } from '../../features/browse/browse-projects';
import {
  defaultDestination,
  preferredDestination,
  projectSides,
  serverPermissions,
  serverTargets,
  targetStates,
  type Destination,
  type DependencyRow,
  type ServerTarget,
  type TargetStates,
} from '../../features/browse/install-targets';
import { prepareServerSelection, serverSoftware } from '../../features/browse/server-install';
import { contentErrorMessage } from '../../features/servers/content-model';
import type { ServerCommandError } from '../../features/servers/native';
import { instances } from '../../features/instances/catalog';
import type { ConnectionId } from '../../features/servers/native';
import { serverSnapshots } from '../../features/servers/store';
import { serverFocus } from '../../features/browse/browse-store';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import {
  closePicker,
  installFromPicker,
  installIntoNew,
  pickerProject,
  pickerVersion,
} from './install-actions';
import { installFromServerPicker } from './server-install-actions';
import { DependencyStep, ServerRow, TargetStep } from './server-target-steps';

/** Kinds a server or its client modpack can receive. */
const serverKinds: readonly ResourceType[] = ['mod', 'plugin', 'datapack', 'resourcepack', 'shader'];

type Step =
  | { kind: 'pick' }
  | { kind: 'target'; server: ConnectionId; destination: Destination }
  | {
      kind: 'deps';
      server: ConnectionId;
      destination: Destination;
      version?: ResourceVersion;
      rows?: DependencyRow[];
      error?: string;
      packRevision?: string;
      intentId?: string;
    };

type Status =
  | { kind: 'checking' | 'ready' | 'installed' | 'update' | 'replace' }
  | { kind: 'warning' | 'incompatible'; reason: MessageId };

const statusLabels: Record<'checking' | 'ready' | 'installed' | 'update' | 'replace', MessageId> = {
  checking: 'browse.status-checking',
  ready: 'browse.status-ready',
  installed: 'browse.status-installed',
  update: 'browse.status-update',
  replace: 'browse.status-replace',
};

const fitReasons = {
  vanilla: 'browse.reason-vanilla',
  loader: 'browse.reason-loader',
  game: 'browse.reason-game-version',
} satisfies Record<string, MessageId>;

interface Loaded {
  project: ResourceProject;
  /** Undefined when the version list could not be fetched; the install retries it. */
  versions: ResourceVersion[] | undefined;
  rows: Record<string, InstalledRow[]>;
}

/** Choose where a project goes. Each instance shows whether it fits, is installed or can update. */
export function InstancePickerDialog() {
  const [filter, setFilter] = createSignal('', { name: 'browsePickerFilter' });
  const [loaded, setLoaded] = createSignal<Loaded | undefined>(undefined, { name: 'browsePickerLoaded' });
  const [step, setStep] = createSignal<Step>({ kind: 'pick' }, { name: 'browsePickerStep' });
  const [software, setSoftware] = createSignal<Record<ConnectionId, string | null>>({}, { name: 'browsePickerSoftware' });
  let depsRequest = 0;
  /** The server Browse was opened for; chosen for the user once its row can take the project. */
  let preselect: ConnectionId | undefined;

  createEffect(
    () => pickerProject(),
    (project) => {
      setFilter('');
      setLoaded(undefined);
      setStep({ kind: 'pick' });
      depsRequest++;
      preselect = project ? untrack(serverFocus)?.id : undefined;
      if (!project) return;
      let cancelled = false;
      const entries = untrack(instances);
      // Software decides whether mods or plugins can go on a server; read once per opening.
      if (serverKinds.includes(project.resource_type))
        for (const snapshot of untrack(serverSnapshots)) {
          const allowed = serverPermissions(snapshot);
          if ((!allowed.server && !allowed.modpack) || snapshot.state.phase !== 'online') continue;
          void serverSoftware(snapshot.connection.id).then((id) => {
            if (!cancelled) setSoftware((current) => ({ ...current, [snapshot.connection.id]: id }));
          });
        }
      void (async () => {
        const [versions, ...lists] = await Promise.all([
          loadVersions(project.source, project.id).catch(() => undefined),
          ...entries.map((entry) => fetchInstalled(entry.instance.id).catch(() => [] as InstalledRow[])),
        ]);
        if (cancelled) return;
        setLoaded({
          project,
          versions,
          rows: Object.fromEntries(entries.map((entry, index) => [entry.instance.id, lists[index]])),
        });
      })();
      return () => {
        cancelled = true;
      };
    },
  );

  const list = createMemo(
    () => {
      const project = pickerProject();
      const pinned = pickerVersion();
      const data = loaded();
      const needle = filter().trim().toLowerCase();
      if (!project) return [];
      const rowFor = (rows: Loaded['rows'] | undefined, instanceId: string) =>
        rows?.[instanceId]?.find(
          (item) => projectKey(item.platform.toLowerCase(), item.remote_id) === projectKey(project.source, project.id),
        );
      return instances()
        .filter((entry) => !needle || entry.instance.name.toLowerCase().includes(needle))
        .map((entry) => {
          const instance = entry.instance;
          const status = ((): Status => {
            // One exact version: it fits or it does not; an installed copy is replaced.
            if (pinned) {
              const fit = versionFit(pinned, instance, project.resource_type, project.source);
              if (fit.kind !== 'fits') return { kind: 'incompatible', reason: fitReasons[fit.kind] };
              if (!data) return { kind: 'checking' };
              const row = rowFor(data?.rows, instance.id);
              if (row) return row.remote_version_id === pinned.id ? { kind: 'installed' } : { kind: 'replace' };
              return fit.borrowedLoader
                ? {
                    kind: 'warning',
                    reason:
                      instance.modloader.toLowerCase() === 'quilt'
                        ? 'browse.reason-fabric-on-quilt'
                        : 'browse.reason-forge-on-neoforge',
                  }
                : { kind: 'ready' };
            }
            const compatibility = projectCompatibility(project, project.resource_type, instance);
            if (compatibility.kind === 'incompatible')
              return { kind: 'incompatible', reason: `browse.reason-${compatibility.reason}` };
            if (!data) return { kind: 'checking' };
            const row = rowFor(data?.rows, instance.id);
            const choice = data.versions
              ? selectInstallVersion(data.versions, instance, project.resource_type, project.source)
              : undefined;
            if (data.versions && !choice && !row) return { kind: 'incompatible', reason: 'browse.reason-no-version' };
            if (row) return updateAvailable(row, choice) ? { kind: 'update' } : { kind: 'installed' };
            if (compatibility.kind === 'warning')
              return { kind: 'warning', reason: `browse.reason-${compatibility.reason}` };
            return { kind: 'ready' };
          })();
          return { instance, status };
        });
    },
    { name: 'browsePickerRows' },
  );

  /** Servers the user may install to or edit the pack of, each with what it can receive. */
  const servers = createMemo(
    () => {
      const project = pickerProject();
      if (!project || !serverKinds.includes(project.resource_type)) return [];
      const data = loaded();
      const needle = filter().trim().toLowerCase();
      const known = software();
      return serverTargets(serverSnapshots(), (id) => (id in known ? known[id] : undefined))
        .filter((target) => !needle || target.name.toLowerCase().includes(needle))
        .map((target) => ({
          target,
          states: targetStates(target, {
            project,
            kind: project.resource_type,
            versions: data?.versions,
            pinned: pickerVersion(),
          }),
          checking: !data,
        }));
    },
    { name: 'browsePickerServers' },
  );
  const showServers = createMemo(
    () => {
      const project = pickerProject();
      return (
        !!project &&
        serverKinds.includes(project.resource_type) &&
        serverSnapshots().some((snapshot) => {
          const allowed = serverPermissions(snapshot);
          return allowed.server || allowed.modpack;
        })
      );
    },
    { name: 'browsePickerShowServers' },
  );
  const chosen = createMemo(
    () => {
      const current = step();
      if (current.kind === 'pick') return undefined;
      return servers().find((row) => row.target.id === current.server);
    },
    { name: 'browsePickerChosenServer' },
  );
  const suggested = createMemo(
    () => {
      const project = pickerProject();
      return project ? preferredDestination(projectSides(project), project.resource_type) : 'server';
    },
    { name: 'browsePickerSuggested' },
  );

  const chooseServer = (row: { target: ServerTarget; states: TargetStates }) => {
    const project = untrack(pickerProject);
    if (!project) return;
    const destination = defaultDestination(projectSides(project), project.resource_type, row.states);
    setStep({ kind: 'target', server: row.target.id, destination });
  };

  // Skip the list when Browse was opened for one server and that server can take the project.
  // A row that cannot (or is gone) leaves the list showing, with its reason.
  createEffect(
    () => ({ rows: servers(), picking: step().kind === 'pick' }),
    ({ rows, picking }) => {
      if (!preselect || !picking) return;
      const row = rows.find((entry) => entry.target.id === preselect);
      if (!row) {
        if (rows.length || untrack(loaded)) preselect = undefined;
        return;
      }
      const state = row.states.row;
      if ((row.checking && row.target.connection === 'online') || (!state.available && state.reason === 'checking')) return;
      preselect = undefined;
      if (state.available) chooseServer(row);
    },
    { name: 'browsePickerPreselect' },
  );

  /** Settles the version for the destination, then asks the resolver for its dependencies. */
  const continueToDependencies = async () => {
    const current = untrack(step);
    const row = untrack(chosen);
    const project = untrack(pickerProject);
    if (current.kind !== 'target' || !row || !project) return;
    const request = ++depsRequest;
    const base = { kind: 'deps' as const, server: current.server, destination: current.destination };
    setStep(base);
    try {
      const pinned = untrack(pickerVersion);
      const versions = pinned
        ? [pinned]
        : (untrack(loaded)?.versions ?? (await loadVersions(project.source, project.id)));
      const prepared = await prepareServerSelection(row.target, project, versions, current.destination);
      if (request !== depsRequest) return;
      if (!prepared) {
        setStep({ ...base, error: t('browse.target-reason-no-version') });
        return;
      }
      setStep({ ...base, ...prepared });
    } catch (reason) {
      if (request === depsRequest) setStep({ ...base, error: t(contentErrorMessage(reason as ServerCommandError)) });
    }
  };

  const toggleDependency = (index: number, selected: boolean) =>
    setStep((current) =>
      current.kind === 'deps' && current.rows
        ? { ...current, rows: current.rows.map((row, at) => (at === index ? { ...row, selected } : row)) }
        : current,
    );

  const install = () => {
    const current = untrack(step);
    const row = untrack(chosen);
    const project = untrack(pickerProject);
    if (current.kind !== 'deps' || !current.version || !current.rows || !row || !project) return;
    void installFromServerPicker(row.target, {
      project,
      version: current.version,
      kind: project.resource_type,
      destination: current.destination,
      dependencies: current.rows,
      packRevision: current.packRevision,
      intentId: current.intentId,
    });
  };

  const back = () => {
    depsRequest++;
    setStep((current) =>
      current.kind === 'deps'
        ? { kind: 'target', server: current.server, destination: current.destination }
        : { kind: 'pick' },
    );
  };

  const title = () => {
    const current = step();
    const project = pickerProject();
    if (current.kind === 'target') return t('browse.target-title', { title: chosen()?.target.name ?? '' });
    if (current.kind === 'deps') return t('browse.deps-title', { name: project?.name ?? '' });
    return showServers() ? t('browse.picker-title-any') : t('browse.picker-title');
  };
  const description = () => {
    const project = pickerProject();
    if (!project) return undefined;
    if (step().kind === 'target') return t('browse.target-description', { name: project.name });
    if (step().kind === 'deps') return undefined;
    const pinned = pickerVersion();
    return pinned
      ? t('browse.picker-description-version', { name: project.name, version: pinned.version_number })
      : t('browse.picker-description', { name: project.name });
  };

  const footer = () => {
    const current = step();
    if (current.kind === 'pick')
      return (
        <Button
          size="sm"
          variant="outline"
          icon={<Icon name="icons/actions/add" size={14} />}
          onClick={() => {
            const project = pickerProject();
            if (project) void installIntoNew(project, project.resource_type);
          }}
        >
          {t('browse.picker-new-instance')}
        </Button>
      );
    const ready =
      current.kind === 'target' ? !!chosen()?.states[current.destination].available : !!current.version && !!current.rows;
    return (
      <div data-vesta="browse-picker-footer">
        <Button size="sm" variant="ghost" onClick={back}>
          {t('browse.target-back')}
        </Button>
        <Button
          size="sm"
          variant="solid"
          tone="accent"
          disabled={!ready}
          icon={current.kind === 'deps' ? <Icon name="icons/actions/download" size={14} /> : undefined}
          onClick={() => (untrack(step).kind === 'target' ? void continueToDependencies() : install())}
        >
          {t(current.kind === 'target' ? 'browse.target-continue' : 'browse.deps-install')}
        </Button>
      </div>
    );
  };

  const depsStep = () => {
    const current = step();
    return current.kind === 'deps' ? current : undefined;
  };
  const targetStep = () => {
    const current = step();
    const row = chosen();
    return current.kind === 'target' && row ? { ...row, destination: current.destination } : undefined;
  };

  return (
    <Dialog
      closeLabel={t('nav.close')}
      open={!!pickerProject()}
      onOpenChange={(open) => !open && closePicker()}
      size="md"
      title={title()}
      description={description()}
      footer={footer()}
    >
      <Show when={step().kind === 'pick'}>
        <div data-vesta="browse-picker">
          <TextField
            size="sm"
            aria-label={t(showServers() ? 'browse.picker-search-any' : 'browse.picker-search')}
            placeholder={t(showServers() ? 'browse.picker-search-any' : 'browse.picker-search')}
            icon={<Icon name="icons/content/search" size={14} />}
            value={filter()}
            onChange={setFilter}
          />
          <div data-vesta="browse-picker-sections">
            <section data-vesta="browse-picker-section">
              <Show when={showServers()}>
                <h3 data-vesta="browse-picker-heading">{t('browse.picker-instances')}</h3>
              </Show>
              <ul data-vesta="browse-picker-list">
                <For each={list()} keyed={(row) => row.instance.id}>
                  {(row) => {
                    const status = () => row().status;
                    const disabled = () => !['ready', 'warning', 'update', 'replace'].includes(status().kind);
                    return (
                      <li data-vesta="browse-picker-row" data-status={status().kind}>
                        <button
                          type="button"
                          data-vesta="browse-picker-choice"
                          disabled={disabled()}
                          onClick={() => {
                            const project = pickerProject();
                            if (project) void installFromPicker(project, project.resource_type, { ...row().instance });
                          }}
                        >
                          <img
                            data-vesta="browse-picker-icon"
                            src={row().instance.image}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                          <span data-vesta="browse-picker-text">
                            <strong>{row().instance.name}</strong>
                            <span>
                              {row().instance.minecraftVersion} · {row().instance.modloader}
                            </span>
                          </span>
                          <span data-vesta="browse-picker-status" data-status={status().kind}>
                            <Show when={status().kind === 'installed'}>
                              <Icon name="icons/controls/check" size={12} />
                            </Show>
                            <Show
                              when={'reason' in status()}
                              fallback={t(statusLabels[status().kind as keyof typeof statusLabels])}
                            >
                              {t((status() as { reason: MessageId }).reason)}
                            </Show>
                          </span>
                        </button>
                      </li>
                    );
                  }}
                </For>
              </ul>
              <Show when={!list().length}>
                <EmptyLine>{t('browse.picker-empty')}</EmptyLine>
              </Show>
            </section>
            <Show when={showServers()}>
              <section data-vesta="browse-picker-section" data-kind="servers">
                <h3 data-vesta="browse-picker-heading">{t('browse.picker-servers')}</h3>
                <ul data-vesta="browse-picker-list">
                  <For each={servers()} keyed={(row) => row.target.id}>
                    {(row) => (
                      <ServerRow
                        target={row().target}
                        state={row().checking && row().target.connection === 'online' ? 'checking' : row().states.row}
                        only={row().states.only}
                        onChoose={() => chooseServer(row())}
                      />
                    )}
                  </For>
                </ul>
                <Show when={!servers().length}>
                  <EmptyLine>{t('browse.picker-servers-empty')}</EmptyLine>
                </Show>
              </section>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={targetStep()}>
        {(current) => (
          <TargetStep
            target={current().target}
            states={current().states}
            suggested={suggested()}
            selected={current().destination}
            onSelect={(destination) =>
              setStep((previous) => (previous.kind === 'target' ? { ...previous, destination } : previous))
            }
          />
        )}
      </Show>
      <Show when={depsStep()}>
        {(current) => <DependencyStep rows={current().rows} error={current().error} onToggle={toggleDependency} />}
      </Show>
    </Dialog>
  );
}
