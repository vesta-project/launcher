// Add a server to a Vesta Server machine. New comes first: everything is filled in from the
// machine's own suggestions, so the quickest path is Continue, tick the EULA, Create. Restore
// and Import share the same settings, the same review and the same progress screen. The job
// itself lives in hosts-store, so leaving this page never stops the machine.
import { Button, Checkbox, Combobox, NumberField, Progress, SegmentedControl, Skeleton, Slider, Switch as Toggle, TextField } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onSettled, untrack } from 'solid-js';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { OptionCards } from '../../components/option-cards';
import { SoftwareMark } from '../../components/software-mark';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { openExternal } from '../../features/links/external-links';
import { formatBytes } from '../../features/settings/storage-model';
import { toServerError } from '../../features/servers/errors';
import {
  acknowledgedWarnings, acknowledgements, addProblem, addSupport, buildOptions, chosenBuild, experimentalChoice, findVersion, folderVerdict, formatMemory,
  keepKind, memoryRange, needsBuild, needsFreshPlan, notOffered, packNotices, phaseAt, phaseProgress, phaseSteps, primaryLabel, readDefaults, readResources,
  readRestoreSources, recommendedBuild, reviewFacts, reviewProblems, settingsProblem, softwareChoice, softwareKinds, softwareLabel, startVersion,
  supportedModes, unavailableKinds, validPort, versionOptions, waitingFor,
  type AddMode, type FolderVerdict, type Problem, type ResourceCheck, type ReviewFacts,
} from '../../features/servers/host-add-model';
import { importBusy } from '../../features/servers/host-model';
import {
  addTask, applyAdd, cancelAdd, clearAdd, hostCommand, hostInfo, loadHostServers, planAdd, recheckAdd, replanAdd, resumeAdd, startAdd, vestaHost,
  type AddRequest, type AddTask,
} from '../../features/servers/hosts-store';
import { hostConnectionId, type CreateDefaults, type ImportJob, type MinecraftCatalogue, type RestoreSource, type SoftwareCatalogue } from '../../features/servers/native-hosts';
import type { ServerCommandError } from '../../features/servers/native';
import { softwareIcon, softwareVersionKind } from '../../features/servers/software-flow';
import type { SoftwareId } from '../../features/servers/hosting-native';
import { ImportFolderStep, PermissionHelp, checkPath, type Picked } from './host-import';
import { CommandLine, Steps, Working } from './vesta-parts';
import './vesta-server.css';
import './host-add.css';

type Field = 'name' | 'port' | 'memory';
type Stage = 'choose' | 'sending' | 'review' | 'progress';
interface Settings { name: string; port: number; memory: number; edited: Partial<Record<Field, boolean>> }

const EULA_URL = 'https://aka.ms/MinecraftEULA';

const modeIcons: Record<AddMode, string> = { new: 'icons/actions/add', modpack: 'icons/content/modpack', restore: 'icons/content/history', import: 'icons/content/folder' };
const modeLabels: Record<AddMode, MessageId> = { new: 'server-add.mode.new', modpack: 'server-add.mode.modpack', restore: 'server-add.mode.restore', import: 'server-add.mode.import' };
const modeHints: Record<AddMode, MessageId> = { new: 'server-add.mode.new-hint', modpack: 'server-add.mode.modpack-hint', restore: 'server-add.mode.restore-hint', import: 'server-add.mode.import-hint' };
const chooseLabels: Record<AddMode, MessageId> = { new: 'server-add.step.server', modpack: 'server-add.step.pack', restore: 'server-add.step.backup', import: 'vesta-server.import.step-folder' };
const makeLabels: Record<AddMode, MessageId> = { new: 'server-add.step.create', modpack: 'server-add.step.create', restore: 'server-add.step.restore', import: 'vesta-server.import.step-copy' };

/** The software's mark on its tinted tile, or a server glyph when the software isn't known. */
function Mark(props: { kind: string | null | undefined; size?: 'sm' | 'lg' }) {
  const icon = () => (props.kind ? softwareIcon[props.kind as SoftwareId] : undefined);
  return <SoftwareMark software={icon() ? props.kind! : 'original'} icon={icon() ?? 'icons/content/server'} size={props.size} />;
}

export function HostAdd(props: { hostId: string }) {
  const host = () => vestaHost(props.hostId);
  return (
    <Show when={host()} fallback={
      <Board>
        <EmptyState icon="icons/rail/servers" title={t('vesta-server.missing')}>
          <Button onClick={() => transitionTo('/servers')}>{t('servers.done.all-servers')}</Button>
        </EmptyState>
      </Board>
    }>
      {(found) => <AddWizard hostId={props.hostId} machine={found().name} />}
    </Show>
  );
}

// ------------------------------------------------------------------ the wizard

interface ImportChoice {
  folder: Picked;
  state: 'checking' | FolderVerdict | { kind: 'error'; error: ServerCommandError };
  /** Vesta Server just got permission after "Check again": said out loud on the folder step. */
  granted: boolean;
  still: boolean;
  rechecking: boolean;
}

function AddWizard(props: { hostId: string; machine: string }) {
  const task = () => addTask(props.hostId);
  const initial = untrack(task);
  const planned = initial?.request ?? null;
  // Reopened while the machine works (or after a restart): read the job again.
  onSettled(() => { if (untrack(task)?.jobId) recheckAdd(props.hostId); });

  // What the machine offers, asked once each time the wizard opens.
  const [defaults, setDefaults] = createSignal<CreateDefaults | 'none' | null>(null, { name: 'host-add:defaults' });
  const [sources, setSources] = createSignal<RestoreSource[]>([], { name: 'host-add:sources' });
  const [capabilities, setCapabilities] = createSignal<string[] | null>(hostInfo(props.hostId)?.capabilities ?? null, { name: 'host-add:capabilities' });
  const [versions, setVersions] = createSignal<MinecraftCatalogue | null>(null, { name: 'host-add:versions' });
  const [resources, setResources] = createSignal<ResourceCheck | null>(null, { name: 'host-add:resources' });
  const [loaded, setLoaded] = createSignal(false, { name: 'host-add:loaded' });
  const [loadError, setLoadError] = createSignal<ServerCommandError | null>(null, { name: 'host-add:load-error' });
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const [mode, setMode] = createSignal<AddMode>(initial?.mode ?? 'new', { name: 'host-add:mode' });
  const [editing, setEditing] = createSignal(false, { name: 'host-add:editing' });
  const [focus, setFocus] = createSignal<Field | null>(null, { name: 'host-add:focus' });

  // New: Minecraft version, software and build.
  const plannedNew = planned?.mode === 'new' ? planned.body : null;
  const [version, setVersion] = createSignal<string | null>(plannedNew && plannedNew.kind === 'new' ? plannedNew.minecraftVersion : null, { name: 'host-add:version' });
  const [snapshots, setSnapshots] = createSignal(false, { name: 'host-add:snapshots' });
  const [wantedKind, setWantedKind] = createSignal(plannedNew && plannedNew.kind === 'new' ? plannedNew.software.kind : 'vanilla', { name: 'host-add:kind' });
  const [pickedBuild, setPickedBuild] = createSignal<{ key: string; id: string } | null>(null, { name: 'host-add:build' });
  const [catalogues, setCatalogues] = createSignal<Record<string, SoftwareCatalogue | ServerCommandError | 'loading'>>({}, { name: 'host-add:catalogues' });

  // Restore: which backup.
  const plannedRestore = planned?.mode === 'restore' && planned.body.kind === 'restore' && planned.body.source.kind === 'snapshot' ? planned.body.source.sourceId : null;
  const [restoreId, setRestoreId] = createSignal<string | null>(plannedRestore, { name: 'host-add:restore' });

  // Import: the folder, and whether it is a readable server yet.
  const [importChoice, setImportChoice] = createSignal<ImportChoice | null>(planned?.mode === 'import'
    ? { folder: { ...planned.folder, name: planned.body.name }, state: { kind: 'server' }, granted: false, still: false, rechecking: false } : null, { name: 'host-add:folder' });

  // Name, port and memory: one set for creating, one for importing (which keeps the folder's own name).
  const fromPlan = (): Settings | null => {
    if (!planned) return null;
    const body = planned.body;
    return { name: body.name, port: body.gamePort ?? 25565, memory: body.memoryMiB ?? 4096, edited: { name: true, port: body.gamePort !== null, memory: body.memoryMiB !== null } };
  };
  const blank: Settings = { name: '', port: 25565, memory: 4096, edited: {} };
  const [createSettings, setCreateSettings] = createSignal<Settings>(planned && planned.mode !== 'import' ? fromPlan()! : blank, { name: 'host-add:create-settings' });
  const [importSettings, setImportSettings] = createSignal<Settings>(planned?.mode === 'import' ? fromPlan()! : blank, { name: 'host-add:import-settings' });
  const settings = () => (mode() === 'import' ? importSettings() : createSettings());
  const setSettings = (next: Settings) => (mode() === 'import' ? setImportSettings(next) : setCreateSettings(next));
  /** Fill in what the person hasn't touched with what the machine suggested. */
  const suggest = (set: (next: (current: Settings) => Settings) => void, values: Partial<Pick<Settings, Field>>) => set((current) => ({
    ...current,
    name: current.edited.name || values.name === undefined ? current.name : values.name,
    port: current.edited.port || values.port === undefined ? current.port : values.port,
    memory: current.edited.memory || values.memory === undefined ? current.memory : values.memory,
  }));

  const load = async () => {
    setLoadError(null);
    const [info, suggested, backups, catalogue, spare] = await Promise.allSettled([
      hostCommand((client) => client.info(props.hostId)),
      hostCommand((client) => client.createDefaults(props.hostId)),
      hostCommand((client) => client.createRestoreSources(props.hostId)),
      hostCommand((client) => client.catalogueMinecraft(props.hostId)),
      hostCommand((client) => client.importResources(props.hostId, null, null)),
    ]);
    if (disposed) return;
    if (info.status === 'fulfilled') setCapabilities(info.value.capabilities ?? []);
    if (suggested.status === 'fulfilled') {
      const read = readDefaults(suggested.value);
      setDefaults(read);
      suggest(setCreateSettings, { name: read.name, port: read.gamePort, memory: read.memoryMiB });
      suggest(setImportSettings, { port: read.gamePort, memory: read.memoryMiB });
    } else {
      setDefaults('none');
      // Nothing answered at all: the machine is out of reach, not merely older.
      if (info.status === 'rejected' && !notOffered(suggested.reason)) setLoadError(toServerError(suggested.reason));
    }
    setSources(backups.status === 'fulfilled' ? readRestoreSources(backups.value) : []);
    if (catalogue.status === 'fulfilled') setVersions(catalogue.value);
    if (spare.status === 'fulfilled') {
      const read = readResources(spare.value);
      setResources(read);
      if (suggested.status === 'rejected') suggest(setImportSettings, { port: read.suggestedPort ?? undefined });
    }
    setLoaded(true);
  };
  onSettled(() => void load());

  const support = createMemo(() => addSupport({ capabilities: capabilities(), defaults: typeof defaults() === 'object' && defaults() !== null, restoreSources: sources().length }), { name: 'host-add:support' });
  const modes = createMemo(() => supportedModes(support()), { name: 'host-add:modes' });
  const shownMode = (): AddMode => (modes().includes(mode()) ? mode() : modes()[0] ?? mode());

  // ---------------------------------------------------------------- New: version and software

  const suggestedVersion = () => { const value = defaults(); return value && value !== 'none' ? value.minecraftVersion : null; };
  const chosenVersion = () => version() ?? startVersion(versions(), suggestedVersion());
  const catalogueFor = (id: string | null) => (id ? catalogues()[id] : undefined);
  const softwareCatalogue = () => { const value = catalogueFor(chosenVersion()); return value && value !== 'loading' && !('code' in value) ? value : null; };
  const softwareError = () => { const value = catalogueFor(chosenVersion()); return value && value !== 'loading' && 'code' in value ? value : null; };
  const loadSoftware = async (id: string) => {
    setCatalogues((current) => ({ ...current, [id]: 'loading' }));
    try {
      const value = await hostCommand((client) => client.catalogueSoftware(props.hostId, id));
      if (!disposed) setCatalogues((current) => ({ ...current, [id]: value }));
    } catch (reason) {
      if (!disposed) setCatalogues((current) => ({ ...current, [id]: toServerError(reason) }));
    }
  };
  createEffect(() => (shownMode() === 'new' ? chosenVersion() : null), (id) => {
    if (id && !untrack(catalogues)[id]) void loadSoftware(id);
  }, { name: 'host-add:load-software' });

  const kinds = createMemo(() => softwareKinds(softwareCatalogue()), { name: 'host-add:kinds' });
  const kindId = () => (softwareCatalogue() ? keepKind(kinds(), wantedKind()) ?? 'vanilla' : wantedKind());
  const kind = () => kinds().find((entry) => entry.kind === kindId()) ?? null;
  const buildKey = () => `${chosenVersion()}:${kindId()}`;
  const buildId = () => (pickedBuild()?.key === buildKey() ? pickedBuild()!.id : null);
  const build = () => chosenBuild(kind(), buildId());

  // ---------------------------------------------------------------- port check as it's typed

  const [portBusy, setPortBusy] = createSignal<number | null>(null, { name: 'host-add:port-busy' });
  let portTimer: ReturnType<typeof setTimeout> | undefined;
  let portSequence = 0;
  onCleanup(() => clearTimeout(portTimer));
  const checkPort = (port: number) => {
    clearTimeout(portTimer);
    if (!validPort(port)) return;
    const sequence = ++portSequence;
    portTimer = setTimeout(async () => {
      try {
        const read = readResources(await hostCommand((client) => client.importResources(props.hostId, port, null)));
        if (!disposed && sequence === portSequence) setPortBusy(read.portProblem === 'in-use' ? port : null);
      } catch { /* Older machines can't preview; review still checks the port. */ }
    }, 450);
  };
  const changeSettings = (next: Settings) => {
    if (next.port !== settings().port) checkPort(next.port);
    setSettings(next);
  };

  // ---------------------------------------------------------------- import: check the folder

  const inspectFolder = async (folder: Picked, granted = false) => {
    setImportChoice({ folder, state: 'checking', granted, still: false, rechecking: false });
    try {
      const report = await hostCommand((client) => client.importInspect(props.hostId, folder.token));
      if (disposed || untrack(importChoice)?.folder.token !== folder.token) return;
      const verdict = folderVerdict(report, folder.displayPath);
      setImportChoice({ folder, state: verdict, granted, still: false, rechecking: false });
      if (verdict.kind === 'server') suggest(setImportSettings, { name: folder.name });
    } catch (reason) {
      if (disposed) return;
      const error = toServerError(reason);
      // An older machine can't inspect: the review step checks the folder instead.
      if (notOffered(error)) {
        setImportChoice({ folder, state: { kind: 'server' }, granted, still: false, rechecking: false });
        suggest(setImportSettings, { name: folder.name });
      } else setImportChoice({ folder, state: { kind: 'error', error }, granted, still: false, rechecking: false });
    }
  };
  /** "Check again" on a folder Vesta Server couldn't read: the same folder, asked again. */
  const recheckFolder = async () => {
    const choice = importChoice();
    if (!choice) return;
    setImportChoice({ ...choice, rechecking: true, still: false });
    const outcome = await checkPath(props.hostId, choice.folder.displayPath);
    if (disposed) return;
    if (outcome.kind === 'ok') await inspectFolder({ ...choice.folder, token: outcome.token }, true);
    else setImportChoice({ ...choice, rechecking: false, still: true });
  };

  // ---------------------------------------------------------------- continue to review

  const continueBlocker = (): MessageId | null => {
    const current = shownMode();
    if (current === 'import') {
      const choice = importChoice();
      if (!choice || choice.state === 'checking' || choice.state.kind !== 'server') return 'server-add.continue.folder';
    }
    if (current === 'restore' && !restoreId()) return 'server-add.continue.backup';
    if (current === 'new') {
      if (!chosenVersion()) return 'server-add.continue.version';
      if (kindId() !== 'vanilla' && !kind()) return 'server-add.continue.software';
      if (needsBuild(kind(), buildId())) return 'server-add.continue.build';
    }
    const problem = settingsProblem({ name: settings().name, gamePort: settings().port, memoryMiB: settings().memory });
    if (problem === 'name') return 'server-add.continue.name';
    if (problem === 'port') return 'server-add.settings.port-range';
    return problem === 'memory' ? 'server-add.blocker.memory-small' : null;
  };

  const request = (): AddRequest | null => {
    const current = shownMode();
    const values = settings();
    const name = values.name.trim();
    if (current === 'import') {
      const choice = importChoice();
      if (!choice) return null;
      return {
        mode: 'import', folder: { token: choice.folder.token, displayPath: choice.folder.displayPath },
        // Untouched values are left to the machine, which may keep what the folder already uses.
        body: { folderToken: choice.folder.token, name, gamePort: values.edited.port ? values.port : null, memoryMiB: values.edited.memory ? values.memory : null, launchChoice: null, minecraftVersion: null },
      };
    }
    const resources = { name, gamePort: values.port, memoryMiB: values.memory, eulaAccepted: false as const };
    if (current === 'restore') {
      const sourceId = restoreId();
      return sourceId ? { mode: 'restore', body: { kind: 'restore', ...resources, source: { kind: 'snapshot', sourceId } } } : null;
    }
    const minecraftVersion = chosenVersion();
    return minecraftVersion ? { mode: 'new', body: { kind: 'new', ...resources, minecraftVersion, software: softwareChoice(kind(), buildId()) } } : null;
  };

  const goToReview = () => {
    const next = request();
    if (!next || continueBlocker()) return;
    setEditing(false);
    void planAdd(props.hostId, next, next.body.name);
  };

  /** Back to the first step, with the field to fix focused, or the source to change. */
  const edit = (field: Field | null, back = false) => {
    const current = untrack(task);
    if (current) setMode(current.mode);
    if (back && current?.mode === 'import') setImportChoice(null);
    setFocus(field);
    setEditing(true);
  };
  const startOver = () => { clearAdd(props.hostId); setEditing(true); };

  const stage = (): Stage => {
    const current = task();
    if (!current || editing()) return 'choose';
    if (!current.jobId || !current.job) return 'sending';
    const state = current.job.state;
    return state === 'planning' || state === 'review' || state === 'blocked' ? 'review' : 'progress';
  };
  const stepMode = () => (stage() === 'choose' ? shownMode() : task()?.mode ?? shownMode());
  const steps = () => [
    { id: 'choose', label: chooseLabels[stepMode()] },
    { id: 'review', label: 'vesta-server.import.step-review' as MessageId },
    { id: 'progress', label: makeLabels[stepMode()] },
  ] as const;
  const stepAt = () => {
    const now = stage();
    if (now === 'choose') return 'choose' as const;
    if (now === 'progress') return task()?.job?.state === 'online' ? 'done' as const : 'progress' as const;
    return 'review' as const;
  };

  return (
    <Board class="servers-board">
      <div data-vesta="server-add" data-wide>
        <Steps steps={steps()} current={stepAt()} />
        <Switch>
          <Match when={stage() === 'choose'}>
            <div data-vesta="server-add-panel">
              <header data-vesta="vesta-step-intro">
                <h1>{t('vesta-server.import.title')}</h1>
                <p>{t('server-add.intro', { name: props.machine })}</p>
              </header>

              <Show when={loaded()} fallback={<div data-vesta="add-loading"><Skeleton height={40} radius={10} /><Skeleton height={160} radius={12} /></div>}>
                <Show when={loadError()}>
                  {(problem) => (
                    <div data-vesta="server-callout" data-tone="danger" role="alert">
                      <p>{t(addProblem(problem(), 'new'))}</p>
                      <Button size="sm" onClick={() => void load()}>{t('common.retry')}</Button>
                    </div>
                  )}
                </Show>
                <Show when={modes().length > 1}>
                  <div data-vesta="add-modes">
                    <SegmentedControl aria-label={t('server-add.mode.label')} value={shownMode()} fill
                      options={modes().map((value) => ({ value, label: t(modeLabels[value]), icon: <Icon name={modeIcons[value]} size={16} /> }))}
                      onChange={(value) => setMode(value as AddMode)} />
                    <p>{t(modeHints[shownMode()], { name: props.machine })}</p>
                  </div>
                </Show>

                <Switch>
                  <Match when={shownMode() === 'new'}>
                    <NewServerFields
                      versions={versions()} snapshots={snapshots()} onSnapshots={setSnapshots}
                      version={chosenVersion()} onVersion={(id) => { setVersion(id); setPickedBuild(null); }}
                      catalogue={softwareCatalogue()} catalogueError={softwareError()} onRetry={() => { const id = chosenVersion(); if (id) void loadSoftware(id); }}
                      kindId={kindId()} onKind={(id) => { setWantedKind(id); setPickedBuild(null); }}
                      buildId={buildId()} onBuild={(id) => setPickedBuild({ key: buildKey(), id })} />
                  </Match>
                  <Match when={shownMode() === 'restore'}>
                    <RestoreFields machine={props.machine} sources={sources()} selected={restoreId()}
                      onSelect={(source) => { setRestoreId(source.sourceId); suggest(setCreateSettings, { name: source.label }); }} />
                  </Match>
                  <Match when={shownMode() === 'import'}>
                    <ImportFields hostId={props.hostId} machine={props.machine} choice={importChoice()} onPick={(folder) => void inspectFolder(folder, !!folder.granted)}
                      onRecheck={() => void recheckFolder()} onClear={() => setImportChoice(null)} />
                  </Match>
                </Switch>

                <Show when={shownMode() !== 'import' || (importChoice()?.state as FolderVerdict | undefined)?.kind === 'server'}>
                  <SettingsGroup machine={props.machine} value={settings()} onChange={changeSettings} available={resources()?.availableMiB ?? null}
                    portBusy={portBusy() === settings().port} focus={focus()} onFocused={() => setFocus(null)} />
                </Show>
              </Show>

              <footer data-vesta="add-footer">
                {/* Continue always checks again and reviews, so one way back out is enough. */}
                <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('common.cancel')}</Button>
                <Show when={loaded() && continueBlocker()}>{(why) => <span data-vesta="add-why" id="add-continue-why">{t(why(), { name: kind() ? softwareLabel(kind()!.kind, kind()!.label)! : '' })}</span>}</Show>
                <Button tone="accent" disabled={!loaded() || !!continueBlocker() || !!task()?.sending} aria-describedby={continueBlocker() ? 'add-continue-why' : undefined} onClick={goToReview}>
                  {t('server-add.continue')}
                </Button>
              </footer>
            </div>
          </Match>

          <Match when={stage() === 'sending' && task()}>
            {(current) => (
              <div data-vesta="server-add-panel">
                <AddHeader kind={null} name={current().name || props.machine} line={t('server-add.on-machine', { name: props.machine })} />
                <Show when={current().error} fallback={<Working label={t('server-add.review.checking', { name: props.machine })} />}>
                  {(error) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(addProblem(error(), current().mode))}</p>}
                </Show>
                <Show when={current().error}>
                  <footer data-vesta="add-footer">
                    <Show when={!current().jobId} fallback={
                      // The machine no longer knows this job: nothing to go back to.
                      <Button tone="accent" onClick={startOver}>{t('server-add.start-over')}</Button>
                    }>
                      <Button variant="ghost" onClick={() => edit(null)}>{t('common.back')}</Button>
                      <Show when={current().request}>
                        <Button tone="accent" icon={<Icon name="icons/actions/refresh" />} onClick={() => void replanAdd(props.hostId)}>{t('vesta-server.import.check-again')}</Button>
                      </Show>
                    </Show>
                  </footer>
                </Show>
              </div>
            )}
          </Match>

          <Match when={stage() === 'review' && task()}>
            {(current) => <ReviewStep hostId={props.hostId} machine={props.machine} task={current()} onEdit={edit} />}
          </Match>

          <Match when={stage() === 'progress' && task()}>
            {(current) => <ProgressStep hostId={props.hostId} machine={props.machine} task={current()} onStartOver={startOver} />}
          </Match>
        </Switch>
      </div>
    </Board>
  );
}

// ------------------------------------------------------------------ new: version and software

function NewServerFields(props: {
  versions: MinecraftCatalogue | null; snapshots: boolean; onSnapshots: (on: boolean) => void;
  version: string | null; onVersion: (id: string) => void;
  catalogue: SoftwareCatalogue | null; catalogueError: ServerCommandError | null; onRetry: () => void;
  kindId: string; onKind: (id: string) => void;
  buildId: string | null; onBuild: (id: string) => void;
}) {
  const versionChoices = createMemo(() => versionOptions(props.versions, props.snapshots, props.version), { name: 'host-add:version-options' });
  const kinds = createMemo(() => softwareKinds(props.catalogue), { name: 'host-add:kind-cards' });
  const cards = createMemo(() => kinds().map((entry) => ({
    value: entry.kind,
    label: softwareLabel(entry.kind, entry.label)!,
    hint: t(`software.hint-${entry.kind}` as MessageId),
    icon: <Mark kind={entry.kind} />,
  })), { name: 'host-add:kind-options' });
  const missing = createMemo(() => unavailableKinds(props.catalogue), { name: 'host-add:kind-missing' });
  const kind = () => kinds().find((entry) => entry.kind === props.kindId) ?? null;
  const builds = createMemo(() => buildOptions(kind()).map((option) => ({
    value: option.value,
    label: option.build.experimental ? t('server-add.software.experimental-build', { version: option.label })
      : option.build.recommended ? t('server-add.software.recommended-build', { version: option.label }) : option.label,
  })), { name: 'host-add:build-options' });
  const shownBuild = () => chosenBuild(kind(), props.buildId)?.id ?? undefined;
  const loaderKind = () => softwareVersionKind(props.kindId as SoftwareId) === 'loader';
  const experimental = () => experimentalChoice({ version: findVersion(props.versions, props.version), kind: kind(), build: chosenBuild(kind(), props.buildId) });

  return (
    <section data-vesta="add-software" aria-label={t('server-add.software.title')}>
      <div data-vesta="add-version-row">
        <div data-vesta="add-field">
          <label>{t('management.minecraft')}</label>
          <Show when={props.versions} fallback={<Skeleton height={32} />}>
            <Combobox aria-label={t('management.minecraft')} options={versionChoices()} pageSize={80} value={props.version ?? undefined}
              onChange={props.onVersion} />
          </Show>
        </div>
        <Toggle label={t('versions.show-snapshots')} checked={props.snapshots} onChange={props.onSnapshots} />
      </div>

      <div data-vesta="add-field">
        <label>{t('server-add.software.label')}</label>
        <Show when={props.catalogue} fallback={
          <Show when={props.catalogueError} fallback={<Skeleton height={76} radius={12} />}>
            {(error) => (
              <div data-vesta="server-callout" data-tone="warning" role="alert">
                <p>{t(addProblem(error(), 'new'))}</p>
                <Button size="sm" onClick={() => props.onRetry()}>{t('common.retry')}</Button>
              </div>
            )}
          </Show>
        }>
          <OptionCards aria-label={t('server-add.software.label')} value={props.kindId} options={cards()} onChange={props.onKind} />
          <For each={missing()}>
            {(group) => <p data-vesta="add-unavailable">{t(group.reason, { version: props.version ?? '' })}: {group.names.join(', ')}</p>}
          </For>
        </Show>
      </div>

      <Show when={props.kindId !== 'vanilla' && builds().length > 0}>
        <div data-vesta="add-field">
          <label>{t(loaderKind() ? 'server-add.software.loader' : 'server-add.software.build')}</label>
          <Combobox aria-label={t(loaderKind() ? 'server-add.software.loader' : 'server-add.software.build')} options={builds()} pageSize={80}
            value={shownBuild()} placeholder={t('server-add.software.pick-build')} onChange={props.onBuild} />
          <Show when={!recommendedBuild(kind())}><p data-vesta="add-note">{t('server-add.software.no-recommended')}</p></Show>
        </div>
      </Show>

      <Show when={experimental()}>
        <p data-vesta="add-note" data-tone="warning"><Icon name="icons/controls/warning" size={14} />{t('server-add.software.experimental-note')}</p>
      </Show>
    </section>
  );
}

// ------------------------------------------------------------------ restore: which backup

function RestoreFields(props: { machine: string; sources: RestoreSource[]; selected: string | null; onSelect: (source: RestoreSource) => void }) {
  const date = (value: string) => { const at = new Date(value); return Number.isNaN(at.getTime()) ? value : at.toLocaleDateString(undefined, { dateStyle: 'medium' }); };
  return (
    <section data-vesta="vesta-section" aria-labelledby="add-backups-heading">
      <h2 id="add-backups-heading">{t('server-add.restore.title', { name: props.machine })}</h2>
      <ul data-vesta="vesta-found" role="radiogroup" aria-labelledby="add-backups-heading">
        <For each={props.sources} keyed={(source) => source.sourceId}>
          {(source) => (
            <li>
              <button type="button" role="radio" aria-checked={props.selected === source().sourceId ? 'true' : 'false'} data-vesta="vesta-machine"
                data-selected={props.selected === source().sourceId ? '' : undefined} onClick={() => props.onSelect(source())}>
                <Mark kind={source().software?.kind} />
                <span data-vesta="vesta-machine-text">
                  <strong>{source().label}</strong>
                  <span>{[softwareLabel(source().software?.kind), source().minecraftVersion, date(source().createdAt)].filter(Boolean).join(', ')}</span>
                </span>
                <span data-vesta="vesta-found-size">{formatBytes(source().bytes)}</span>
                <Icon name={props.selected === source().sourceId ? 'icons/controls/success' : 'icons/controls/chevron-right'} size={16} />
              </button>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ import: the folder

function ImportFields(props: { hostId: string; machine: string; choice: ImportChoice | null; onPick: (folder: Picked) => void; onRecheck: () => void; onClear: () => void }) {
  const state = () => props.choice?.state;
  const verdict = () => { const value = state(); return value && value !== 'checking' ? value : null; };
  const server = () => verdict()?.kind === 'server';
  return (
    <Show when={server() && props.choice} fallback={
      <div data-vesta="add-import-pick">
        <p data-vesta="vesta-remote-note"><Icon name="icons/content/server" size={16} />{t('vesta-server.import.remote', { name: props.machine })}</p>
        <Show when={props.choice}>
          {(choice) => (
            <Switch>
              <Match when={state() === 'checking'}>
                <Working label={t('server-add.import.checking', { name: choice().folder.name })} />
              </Match>
              <Match when={verdict()?.kind === 'unreadable' && (verdict() as Extract<FolderVerdict, { kind: 'unreadable' }>)}>
                {(locked) => (
                  <PermissionHelp name={choice().folder.displayPath} machine={props.machine} command={locked().command}
                    checking={choice().rechecking} still={choice().still} onCheck={() => props.onRecheck()} />
                )}
              </Match>
              <Match when={verdict()?.kind === 'not-server' && (verdict() as Extract<FolderVerdict, { kind: 'not-server' }>)}>
                {(other) => (
                  <div data-vesta="server-callout" data-tone="warning" role="status">
                    <p>{t('server-add.import.not-server', { name: choice().folder.name })} {t(other().reason)}</p>
                    <Show when={other().nearby.length > 0}>
                      <div data-vesta="add-nearby">
                        <For each={other().nearby} keyed={(folder) => folder.token}>
                          {(folder) => (
                            <Button size="sm" variant="outline" icon={<Icon name="icons/content/folder" />}
                              onClick={() => props.onPick({ token: folder().token, displayPath: folder().path, name: folder().name })}>
                              {t('server-add.import.did-you-mean', { name: folder().name })}
                            </Button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </Match>
              <Match when={verdict()?.kind === 'error' && (verdict() as { kind: 'error'; error: ServerCommandError })}>
                {(failed) => (
                  <div data-vesta="server-callout" data-tone="danger" role="alert">
                    <p>{t(addProblem(failed().error, 'import'))}</p>
                    <Button size="sm" onClick={() => props.onPick(choice().folder)}>{t('vesta-server.import.check-again')}</Button>
                  </div>
                )}
              </Match>
            </Switch>
          )}
        </Show>
        <ImportFolderStep hostId={props.hostId} machine={props.machine} onPick={props.onPick} />
      </div>
    }>
      {(choice) => (
        <section data-vesta="add-chosen" aria-label={t('server-add.import.chosen')}>
          <Show when={choice().granted}>
            <p data-vesta="server-callout" data-tone="success" role="status"><Icon name="icons/controls/success" size={16} />{t('server-add.import.granted', { name: props.machine })}</p>
          </Show>
          <div data-vesta="add-chosen-folder">
            <Icon name="icons/content/folder" size={20} />
            <span>
              <strong>{choice().folder.name}</strong>
              <code>{choice().folder.displayPath}</code>
            </span>
            <span data-vesta="add-chosen-ok"><Icon name="icons/controls/success" size={16} />{t('vesta-server.import.folder-ready')}</span>
            <Button size="sm" variant="ghost" onClick={() => props.onClear()}>{t('server-add.import.change')}</Button>
          </div>
        </section>
      )}
    </Show>
  );
}

// ------------------------------------------------------------------ name, port and memory

function SettingsGroup(props: {
  machine: string; value: Settings; onChange: (next: Settings) => void; available: number | null; portBusy: boolean;
  focus: Field | null; onFocused: () => void;
}) {
  let root: HTMLElement | undefined;
  onSettled(() => {
    const field = untrack(() => props.focus);
    if (!field) return;
    // The step is inserted after it settles: wait until the field is in the page, then focus it.
    let frames = 0;
    const attempt = () => {
      const target = root?.querySelector<HTMLElement>(`[data-field="${field}"] input, [data-field="${field}"] [role="slider"]`);
      if (!target?.isConnected && frames++ < 20) { setTimeout(attempt, 16); return; }
      target?.focus();
      if (target instanceof HTMLInputElement) target.select();
      target?.scrollIntoView({ block: 'center', behavior: 'auto' });
      props.onFocused();
    };
    setTimeout(attempt, 0);
  });
  const set = (field: Field, value: string | number) => props.onChange({ ...props.value, [field]: value, edited: { ...props.value.edited, [field]: true } });
  const range = () => memoryRange(props.available, props.value.memory);
  const portError = () => (!validPort(props.value.port) ? t('server-add.settings.port-range') : props.portBusy ? t('server-add.settings.port-busy', { name: props.machine }) : undefined);
  return (
    <section ref={(element) => (root = element)} data-vesta="add-settings" aria-labelledby="add-settings-heading">
      <h2 id="add-settings-heading">{t('server-add.settings.title')}</h2>
      <div data-vesta="add-settings-grid">
        <div data-field="name">
          <TextField label={t('vesta-server.import.name')} value={props.value.name} onChange={(value) => set('name', value)}
            error={props.value.name.trim() ? undefined : t('server-add.continue.name')} />
        </div>
        <div data-field="port">
          <NumberField label={t('vesta-server.import.port')} value={props.value.port} min={1024} max={65535} formatOptions={{ useGrouping: false }}
            onChange={(value) => set('port', Number.isFinite(value) ? Math.round(value) : props.value.port)} error={portError()} />
        </div>
        <div data-field="memory">
          <Slider label={t('vesta-server.import.memory')} value={[Math.min(props.value.memory, range().max)]} min={range().min} max={range().max} step={range().step}
            getValueLabel={(value) => formatMemory(value[0] ?? props.value.memory)}
            description={props.available ? t('server-add.settings.memory-free', { value: formatMemory(props.available), name: props.machine }) : undefined}
            onChange={(value) => set('memory', value[0] ?? props.value.memory)} />
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ one review for every way

/** The server at a glance: its software mark, its name and one line under it. */
function AddHeader(props: { kind: string | null; name: string; line: JSX.Element }) {
  return (
    <header data-vesta="add-summary">
      <Mark kind={props.kind} size="lg" />
      <div>
        <h1>{props.name}</h1>
        <p>{props.line}</p>
      </div>
    </header>
  );
}

const softwareText = (facts: Pick<ReviewFacts, 'software' | 'softwareKind' | 'softwareVersion'>) => {
  if (!facts.software) return null;
  if (!facts.softwareVersion) return facts.software;
  return softwareVersionKind(facts.softwareKind as SoftwareId) === 'build'
    ? t('server-add.review.software-build', { software: facts.software, version: facts.softwareVersion })
    : `${facts.software} ${facts.softwareVersion}`;
};

function ReviewStep(props: { hostId: string; machine: string; task: AddTask; onEdit: (field: Field | null, back?: boolean) => void }) {
  const review = () => (props.task.job?.state === 'planning' ? null : props.task.job?.review ?? null);
  return (
    <Show when={review()?.planId} keyed fallback={
      <div data-vesta="server-add-panel">
        <AddHeader kind={null} name={props.task.name || props.machine} line={t('server-add.on-machine', { name: props.machine })} />
        <Show when={props.task.job?.state === 'planning' || !props.task.job?.review} fallback={null}>
          <Working label={t('server-add.review.checking', { name: props.machine })} />
        </Show>
        <Show when={props.task.error}>{(error) => <p data-vesta="server-callout" data-tone="warning" role="alert">{t(addProblem(error(), props.task.mode))}</p>}</Show>
        <footer data-vesta="add-footer">
          <Button variant="ghost" onClick={() => props.onEdit(null)}>{t('common.back')}</Button>
        </footer>
      </div>
    }>
      {(_planId) => <ReviewBody hostId={props.hostId} machine={props.machine} task={props.task} onEdit={props.onEdit} />}
    </Show>
  );
}

const fixLabels: Record<Field, MessageId> = { name: 'server-add.fix.name', port: 'server-add.fix.port', memory: 'server-add.fix.memory' };
const backLabels: Record<AddMode, MessageId> = { new: 'server-add.fix.version', modpack: 'server-add.fix.pack', restore: 'server-add.fix.backup', import: 'server-add.fix.folder' };

function ReviewBody(props: { hostId: string; machine: string; task: AddTask; onEdit: (field: Field | null, back?: boolean) => void }) {
  const facts = createMemo(() => reviewFacts(props.task.mode, props.task.job!.review!, props.task.name), { name: 'host-add:facts' });
  const problems = createMemo(() => reviewProblems(facts()), { name: 'host-add:problems' });
  const notices = createMemo(() => packNotices(facts()), { name: 'host-add:notices' });
  const rows = createMemo(() => acknowledgements(facts()), { name: 'host-add:acks' });
  const [ticked, setTicked] = createSignal<string[]>([], { name: 'host-add:ticked' });
  const blocked = () => !facts().confirmation || problems().length > 0;
  const stale = () => !!props.task.error && needsFreshPlan(props.task.error);
  const waiting = () => waitingFor(rows(), ticked());
  const busy = () => props.task.sending !== null;
  const values = () => ({
    port: String(facts().gamePort), name: props.machine,
    size: formatBytes(facts().bytes ?? 0), free: formatBytes(facts().freeBytes ?? 0),
  });
  const tick = (id: string, on: boolean) => setTicked((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)));
  const line = () => {
    const software = softwareText(facts());
    const what = [software, facts().minecraftVersion && t('server-add.review.minecraft', { version: facts().minecraftVersion! })].filter(Boolean).join(', ');
    return what ? t('server-add.review.subtitle', { software: what, name: props.machine }) : t('server-add.on-machine', { name: props.machine });
  };

  return (
    <div data-vesta="server-add-panel">
      <AddHeader kind={facts().softwareKind} name={facts().name} line={line()} />

      <dl data-vesta="add-facts">
        <div><dt>{t('management.minecraft')}</dt><dd>{facts().minecraftVersion ?? t('vesta-server.import.unknown')}</dd></div>
        <div><dt>{t('vesta-server.import.software')}</dt><dd>{softwareText(facts()) ?? t('vesta-server.import.unknown')}</dd></div>
        <div><dt>{t('vesta-server.import.port')}</dt><dd>{facts().gamePort}</dd></div>
        <div><dt>{t('vesta-server.import.memory')}</dt><dd>{formatMemory(facts().memoryMiB)}</dd></div>
        <div><dt>{t('vesta-server.import.java')}</dt><dd>{facts().javaMajor ? t('vesta-server.import.java-auto-version', { version: String(facts().javaMajor) }) : t('vesta-server.import.java-auto')}</dd></div>
        <Show when={facts().freeBytes !== null}>
          <div><dt>{t('server-add.review.space')}</dt><dd>{t('server-add.review.free', { free: formatBytes(facts().freeBytes!) })}</dd></div>
        </Show>
        <Show when={facts().bytes !== null}>
          <div><dt>{t('vesta-server.import.size')}</dt><dd>{formatBytes(facts().bytes!)}</dd></div>
        </Show>
        <Show when={facts().restore}>
          {(restore) => <div><dt>{t('server-add.review.backup')}</dt><dd>{restore().label}</dd></div>}
        </Show>
        <Show when={facts().pack}>
          {(pack) => <div><dt>{t('server-add.review.pack')}</dt><dd>{pack().name}</dd></div>}
        </Show>
        <Show when={facts().sourcePath}>
          {(path) => <div data-wide><dt>{t('server-add.review.from')}</dt><dd><code>{path()}</code></dd></div>}
        </Show>
        <div data-wide><dt>{t('server-add.review.where')}</dt><dd><code>{facts().destinationPath}</code></dd></div>
      </dl>

      <Show when={problems().length > 0}>
        <section data-vesta="add-problems" aria-labelledby="add-problems-heading">
          <h2 id="add-problems-heading">{t('server-add.review.fix-first')}</h2>
          <ul>
            <For each={problems()}>
              {(problem) => <ProblemRow problem={problem} mode={props.task.mode} values={values()} onEdit={props.onEdit} />}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={notices().length > 0}>
        <section data-vesta="add-notices" aria-labelledby="add-notices-heading">
          <h2 id="add-notices-heading">{t('server-add.review.notices')}</h2>
          <ul><For each={notices()}>{(notice) => <li>{notice.message}</li>}</For></ul>
        </section>
      </Show>

      <Show when={!blocked() && !stale()}>
        <section data-vesta="add-confirm" aria-labelledby="add-confirm-heading">
          <h2 id="add-confirm-heading">{t('server-add.review.before')}</h2>
          <ul>
            <For each={rows()}>
              {(row) => (
                <li>
                  <Checkbox checked={ticked().includes(row.id)} disabled={busy()} label={t(row.message)} onChange={(on) => tick(row.id, on)} />
                  <Show when={row.id === 'eula'}>
                    <a href={EULA_URL} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void openExternal(EULA_URL); }}>{t('servers.eula.read')}</a>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={props.task.mode === 'import'}>
            <p data-vesta="add-note"><Icon name="icons/security/shield-check" size={14} />{t('vesta-server.import.untouched')}</p>
          </Show>
        </section>
      </Show>

      <Show when={props.task.error}>{(error) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(addProblem(error(), props.task.mode))}</p>}</Show>

      <footer data-vesta="add-footer">
        <Button variant="ghost" disabled={busy()} onClick={() => props.onEdit(null)}>{t('common.back')}</Button>
        <Switch>
          <Match when={blocked() || stale()}>
            <Show when={props.task.request} fallback={
              <Button tone="accent" onClick={() => props.onEdit(null, true)}>{t('server-add.start-over')}</Button>
            }>
              <Button tone="accent" disabled={busy()} icon={<Icon name="icons/actions/refresh" />} onClick={() => void replanAdd(props.hostId)}>{t('vesta-server.import.check-again')}</Button>
            </Show>
          </Match>
          <Match when={true}>
            <Show when={waiting()}>{(why) => <span data-vesta="add-why" id="add-apply-why">{t(why())}</span>}</Show>
            <Button tone="accent" disabled={!!waiting() || busy()} aria-describedby={waiting() ? 'add-apply-why' : undefined}
              onClick={() => void applyAdd(props.hostId, acknowledgedWarnings(facts()))}>
              {props.task.sending === 'apply' ? t('server-add.review.sending') : t(primaryLabel(props.task.mode))}
            </Button>
          </Match>
        </Switch>
      </footer>
    </div>
  );
}

/** One problem as a checklist line, with its fix right on it. */
function ProblemRow(props: { problem: Problem; mode: AddMode; values: Record<string, string | number>; onEdit: (field: Field | null, back?: boolean) => void }) {
  const fix = () => props.problem.fix;
  return (
    <li data-vesta="add-problem">
      <Icon name="icons/controls/warning" size={16} />
      <div>
        <p>{props.problem.text ?? t(props.problem.message ?? 'vesta-server.blocker.other', props.values)}</p>
        <Switch>
          <Match when={fix()?.kind === 'command' && (fix() as Extract<NonNullable<Problem['fix']>, { kind: 'command' }>)}>
            {(command) => <CommandLine command={command().command} />}
          </Match>
          <Match when={fix()?.kind === 'field' && (fix() as Extract<NonNullable<Problem['fix']>, { kind: 'field' }>)}>
            {(field) => <Button size="sm" variant="outline" onClick={() => props.onEdit(field().field)}>{t(fixLabels[field().field])}</Button>}
          </Match>
          <Match when={fix()?.kind === 'back'}>
            <Button size="sm" variant="outline" onClick={() => props.onEdit(null, true)}>{t(backLabels[props.mode])}</Button>
          </Match>
        </Switch>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ one progress screen for every way

function ProgressStep(props: { hostId: string; machine: string; task: AddTask; onStartOver: () => void }) {
  const job = () => props.task.job!;
  const state = () => job().state;
  const facts = () => (job().review ? reviewFacts(props.task.mode, job().review!, props.task.name) : null);
  const name = () => facts()?.name || props.task.name || props.machine;
  const steps = () => phaseSteps(props.task.mode);
  const at = () => phaseAt(props.task.mode, job().phase, state());
  const busy = () => props.task.sending !== null;
  const importing = () => props.task.mode === 'import';
  const [opening, setOpening] = createSignal(false, { name: 'host-add:opening' });

  const open = async () => {
    const serverId = job().serverId;
    setOpening(true);
    try { await loadHostServers(props.hostId); } catch { /* The list catches up on its own. */ }
    finally { setOpening(false); }
    clearAdd(props.hostId);
    transitionTo(serverId ? `/servers/${hostConnectionId({ hostId: props.hostId, serverId })}` : '/servers');
  };
  const finish = () => { clearAdd(props.hostId); transitionTo('/servers'); };
  const working = () => state() === 'applying' || state() === 'interrupted';
  const line = () => t(state() === 'online' ? 'server-add.progress.online-line' : importing() ? 'server-add.progress.copy-line' : 'server-add.progress.line', { name: props.machine });

  return (
    <div data-vesta="server-add-panel">
      <AddHeader kind={facts()?.softwareKind ?? null} name={name()} line={line()} />

      <Show when={working()}>
        <ol data-vesta="add-phases">
          <For each={steps()}>
            {(step, index) => (
              <li data-state={index() < at() ? 'done' : index() === at() ? (state() === 'interrupted' ? 'paused' : 'current') : 'next'}>
                <span data-vesta="add-phase-mark" aria-hidden="true">
                  <Show when={index() < at()} fallback={<Show when={index() === at() && state() === 'applying'}><span data-vesta="vesta-spinner" /></Show>}>
                    <Icon name="icons/controls/check" size={12} />
                  </Show>
                </span>
                <div>
                  <span>{t(step.label)}</span>
                  <Show when={index() === at() && state() === 'applying'}>
                    <PhaseBar progress={job().progress} />
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ol>
      </Show>

      <Switch>
        <Match when={state() === 'applying'}>
          <p data-vesta="add-note">{t(importing() ? 'vesta-server.import.keeps-going' : 'server-add.progress.keeps-going', { name: props.machine })}</p>
        </Match>
        <Match when={state() === 'interrupted'}>
          <p data-vesta="server-callout" data-tone="warning" role="status">{t(importing() ? 'vesta-server.import.paused-help' : 'server-add.progress.paused', { name: props.machine })}</p>
        </Match>
        <Match when={state() === 'ready'}>
          <div data-vesta="add-done">
            <span data-vesta="server-add-done-icon"><Icon name="icons/controls/success" size={28} /></span>
            <div>
              <strong>{t(importing() ? 'vesta-server.import.ready-title' : 'server-add.progress.ready-title', { name: name() })}</strong>
              <p>{t('vesta-server.import.ready-help')}</p>
            </div>
          </div>
          <Show when={job().error}>{(error) => <p data-vesta="server-callout" data-tone="warning" role="alert">{t(addProblem(error(), props.task.mode))}</p>}</Show>
        </Match>
        <Match when={state() === 'starting'}>
          <Working label={t('vesta-server.import.starting')} />
        </Match>
        <Match when={state() === 'online'}>
          <div data-vesta="add-done">
            <span data-vesta="server-add-done-icon"><Icon name="icons/controls/success" size={28} /></span>
            <div>
              <strong>{t('vesta-server.import.online-title')}</strong>
              <p>{t('vesta-server.import.online-help', { name: name() })}</p>
            </div>
          </div>
        </Match>
        <Match when={state() === 'cancelled'}>
          <div data-vesta="add-done" data-tone="neutral">
            <div>
              <strong>{t(importing() ? 'vesta-server.import.cancelled-title' : 'server-add.progress.cancelled-title')}</strong>
              <p>{t(importing() ? 'vesta-server.import.cancelled-help' : 'server-add.progress.cancelled-help', { name: props.machine })}</p>
            </div>
          </div>
        </Match>
        <Match when={state() === 'failed'}>
          <p data-vesta="server-callout" data-tone="danger" role="alert">{t(addProblem(job().error ?? 'failed', props.task.mode))}</p>
          <p data-vesta="add-note">{t(importing() ? 'vesta-server.import.cancelled-help' : 'server-add.progress.failed-help', { name: props.machine })}</p>
        </Match>
      </Switch>

      <Show when={props.task.error}>{(error) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(addProblem(error(), props.task.mode))}</p>}</Show>

      <footer data-vesta="add-footer">
        <Switch>
          <Match when={state() === 'applying'}>
            <Button variant="ghost" disabled={busy() || job().phase === 'registering'} onClick={() => void cancelAdd(props.hostId)}>{t('common.cancel')}</Button>
            <Button tone="accent" onClick={() => transitionTo('/servers')}>{t('vesta-server.import.close')}</Button>
          </Match>
          <Match when={state() === 'interrupted'}>
            <Button variant="ghost" disabled={busy()} onClick={() => void cancelAdd(props.hostId)}>{t('common.cancel')}</Button>
            <Button tone="accent" disabled={busy()} onClick={() => void resumeAdd(props.hostId)}>{t('vesta-server.import.resume')}</Button>
          </Match>
          <Match when={state() === 'ready'}>
            <Button variant="ghost" disabled={busy() || opening()} onClick={() => void open()}>{t('servers.open')}</Button>
            <Button tone="accent" disabled={busy()} icon={<Icon name="icons/actions/play" />} onClick={() => void startAdd(props.hostId)}>{t('vesta-server.import.start')}</Button>
          </Match>
          <Match when={state() === 'starting'}>
            <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('vesta-server.import.close')}</Button>
          </Match>
          <Match when={state() === 'online'}>
            <Button variant="ghost" onClick={finish}>{t('servers.done.all-servers')}</Button>
            <Button tone="accent" disabled={opening()} onClick={() => void open()}>{t('server-add.progress.open')}</Button>
          </Match>
          <Match when={!importBusy(state())}>
            <Button variant="ghost" onClick={finish}>{t('vesta-server.import.close')}</Button>
            <Show when={state() === 'failed' && props.task.request} fallback={
              <Button tone="accent" onClick={() => props.onStartOver()}>{t('server-add.start-over')}</Button>
            }>
              <Button variant="outline" onClick={() => props.onStartOver()}>{t('server-add.progress.change')}</Button>
              <Button tone="accent" icon={<Icon name="icons/actions/refresh" />} onClick={() => void replanAdd(props.hostId)}>{t('server-add.progress.try-again')}</Button>
            </Show>
          </Match>
        </Switch>
      </footer>
    </div>
  );
}

/** Progress within one step: a bar, and how many bytes or files when the machine says. */
function PhaseBar(props: { progress: ImportJob['progress'] }) {
  const read = () => phaseProgress(props.progress);
  const detail = () => {
    const progress = props.progress;
    if (read().bytes) return t('server-add.progress.bytes', { done: formatBytes(progress.bytesDone), total: formatBytes(progress.bytesTotal) });
    if (read().files) return t('server-add.progress.files', { count: progress.filesDone, total: progress.filesTotal });
    return undefined;
  };
  return (
    <div data-vesta="add-phase-bar">
      <Progress size="sm" value={read().percent ?? undefined} label={detail() ?? ''} valueLabel={read().percent === null ? undefined : `${Math.floor(read().percent!)}%`} />
    </div>
  );
}
