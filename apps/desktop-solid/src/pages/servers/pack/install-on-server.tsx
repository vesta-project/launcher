import { sameReviewedPlan } from '../../../features/servers/review-plan';
import { Badge, Button, Checkbox, Dialog, Progress, SegmentedControl, Select, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { sourceById } from '../../../features/browse/browse-model';
import { loadProject, loadVersions, peekProject, peekVersions } from '../../../features/browse/browse-projects';
import { initials, serverArt } from '../../../features/servers/art';
import { backupJobTerminal } from '../../../features/servers/backup-jobs';
import { gate } from '../../../features/servers/capabilities';
import { IntentMemo, lifecycleControls, newIntentId } from '../../../features/servers/model';
import {
  defaultInstallChoices, installConflicts, installWarning, linkProvider, linkSourceKind, linkSourceLabel, offerToPlayers,
  type ConflictChoice,
} from '../../../features/servers/modpack-area-model';
import {
  backupProfileFor, planSoftwareSwitch, reviewApplyRequest, reviewBlocker, reviewCounts, reviewEmpty, runtimeLabel,
  type PackRuntime, type ReviewCountKey, type ReviewPlan,
} from '../../../features/servers/pack-install-review';
import type { ServerCommandError } from '../../../features/servers/native';
import type { PackInstallOutcome, PackInstallProgress, PackInstallSource } from '../../../features/servers/native-pack';
import { useServerResource, invalidateServerResources } from '../../../features/servers/resources';
import { backupsResource, softwareResource, CONTENT_RESOURCES } from '../../../features/servers/server-resources';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { useLifecycle } from '../lifecycle';
import { ServerErrorNote } from '../parts';
import { useModpackArea, type InstallRequestSource } from './area';

const conflictLabel: Record<NonNullable<ReviewPlan['files'][number]['conflict']>, MessageId> = {
  project_version: 'server-pack.conflict-project-version',
  same_filename: 'server-pack.conflict-same-filename',
  unidentified_jar: 'server-pack.conflict-unidentified',
};

const countLabel: Record<ReviewCountKey, MessageId> = {
  added: 'server-pack.review-count-added',
  updated: 'server-pack.review-count-updated',
  removed: 'server-pack.review-count-removed',
  overrides: 'server-pack.review-count-overrides',
  skipped: 'server-pack.review-count-skipped',
};
const countIcon: Record<ReviewCountKey, string> = {
  added: 'icons/actions/add', updated: 'icons/actions/refresh', removed: 'icons/actions/delete', overrides: 'icons/content/file', skipped: 'icons/controls/close',
};

const stageLabel: Record<PackInstallProgress['stage'], MessageId> = {
  archive: 'server-pack.review-stage-archive',
  metadata: 'server-pack.review-stage-metadata',
  download_verify: 'server-pack.install-planning',
  review: 'server-pack.review-stage-review',
};

/** PENDING BACKEND: the outcome names the software job when the install switched software. */
type ReviewOutcome = PackInstallOutcome & { softwareJobId?: string | null };

const sourceKey = (source: PackInstallSource) => JSON.stringify(source);

/**
 * Link the server to a modpack, or update the link: one review that never leaves the dialog.
 * A required software switch is part of the install and needs one acknowledgement; changes are
 * counted with expandable lists, conflicts decided inline, and a backup is a small option.
 */
export function InstallOnServerDialog(props: { request: InstallRequestSource }) {
  const area = useModpackArea();
  const now = useServersClock();
  const lifecycle = useLifecycle(area.snapshot);
  const software = useServerResource(() => area.id(), softwareResource);
  const caps = () => area.snapshot().capabilities;
  const backups = useServerResource(() => area.id(), backupsResource, { enabled: () => gate(caps(), 'backups.create') !== 'denied' });
  const [source, setSource] = createSignal<PackInstallSource>(untrack(() => props.request.source), { name: 'pack-review:source' });
  const [plan, setPlan] = createSignal<ReviewPlan | null>(null, { name: 'pack-review:plan' });
  const [picks, setPicks] = createSignal<Record<string, ConflictChoice>>({}, { name: 'pack-review:picks' });
  const [acknowledged, setAcknowledged] = createSignal(false, { name: 'pack-review:acknowledged' });
  const [backupFirst, setBackupFirst] = createSignal(true, { name: 'pack-review:backup-first' });
  const [backedUp, setBackedUp] = createSignal(false, { name: 'pack-review:backed-up' });
  const [backupFailed, setBackupFailed] = createSignal(false, { name: 'pack-review:backup-failed' });
  const [planning, setPlanning] = createSignal(false, { name: 'pack-review:planning' });
  const [stage, setStage] = createSignal<'backup' | 'install' | null>(null, { name: 'pack-review:stage' });
  const [preparation, setPreparation] = createSignal<PackInstallProgress | null>(null, { name: 'pack-review:preparation' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'pack-review:error' });
  const [outcome, setOutcome] = createSignal<ReviewOutcome | null>(null, { name: 'pack-review:outcome' });
  const [uncertain, setUncertain] = createSignal(false, { name: 'pack-review:uncertain' });
  const intents = new IntentMemo();
  let disposed = false;
  let sequence = 0;
  onCleanup(() => { disposed = true; });
  const busy = () => planning() || stage() !== null;

  // While the agent downloads and verifies, show its stage and progress.
  createEffect(planning, active => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const workspace = await serverCommand(api => api.packDraft(area.id()));
        if (!stopped) setPreparation(workspace.installProgress ?? null);
      } catch { /* The plan request reports actionable failures. */ }
      if (!stopped) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 1000);
    onCleanup(() => { stopped = true; clearTimeout(timer); setPreparation(null); });
  }, { name: 'pack-review:progress' });

  const planNow = async (): Promise<void> => {
    const request = ++sequence;
    const target = untrack(source);
    const startedRevision = untrack(() => software.value()?.revision);
    setPlanning(true); setError(null); setPlan(null); setAcknowledged(false);
    try {
      const value: ReviewPlan = await serverCommand((api) => api.packInstallPlan(area.id(), { source: target }));
      if (disposed || request !== sequence) return;
      if (startedRevision !== undefined && startedRevision !== untrack(() => software.value()?.revision)) return planNow();
      setPlan(value);
      setPicks(defaultInstallChoices(value));
    } catch (reason) { if (!disposed && request === sequence) setError(reason as ServerCommandError); }
    finally { if (!disposed && request === sequence) setPlanning(false); }
  };
  // Plan for the chosen version; a new version choice plans again.
  createEffect(() => sourceKey(source()), () => { void planNow(); }, { name: 'pack-review:plan-source' });
  let softwareRevision: string | undefined;
  createEffect(() => software.value()?.revision, revision => {
    const previous = softwareRevision; softwareRevision = revision;
    if (previous !== undefined && revision !== previous && !untrack(busy) && !untrack(outcome)) void planNow();
  }, { name: 'pack-review:software-revision' });

  const current = (): PackRuntime | null => {
    const launch = software.value()?.current;
    return launch?.software && launch.version ? { software: launch.software, minecraftVersion: launch.version, loaderVersion: launch.loaderVersion ?? null } : null;
  };
  const switchTo = () => { const value = plan(); return value ? planSoftwareSwitch(value, current()) : null; };
  const blocker = () => { const value = plan(); return value ? reviewBlocker(value, acknowledged()) : null; };
  const request = createMemo(() => { const value = plan(); return value ? reviewApplyRequest(value, picks(), acknowledged()) : null; }, { name: 'pack-review:request' });
  const update = () => props.request.mode === 'update';
  const running = () => area.snapshot().status?.state === 'running';
  const backupProfile = () => backupProfileFor(backups.value()?.profiles ?? [], running());
  const wantsBackup = () => !!backupProfile() && backupFirst() && !backedUp();

  /** Runs one backup and waits for it; false when it didn't succeed. */
  const backUp = async (profile: string): Promise<boolean> => {
    let job = await serverCommand((api) => api.backupRun(area.id(), profile, newIntentId()));
    for (let poll = 0; !backupJobTerminal(job) && poll < 900; poll++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (disposed) return false;
      const overview = await serverCommand((api) => api.backups(area.id(), null));
      job = overview.jobs.find((entry) => entry.id === job.id) ?? job;
    }
    invalidateServerResources(area.id(), ['backups', 'backup-storage', 'backup-snapshots']);
    return job.state === 'succeeded';
  };

  const apply = async () => {
    let body = request();
    if (!body || blocker()) return;
    setError(null); setBackupFailed(false);
    try {
      const profile = backupProfile();
      if (wantsBackup() && profile) {
        setStage('backup');
        if (!await backUp(profile)) { if (!disposed) setBackupFailed(true); return; }
        if (disposed) return;
        setBackedUp(true);
      }
      setStage('install');
      // Plans don't expire for the user: re-plan quietly and only stop if what changes differs.
      const previous = plan();
      if (previous && previous.expiresAtMs <= now()) {
        const fresh: ReviewPlan = await serverCommand(api => api.packInstallPlan(area.id(), { source: untrack(source) }));
        if (disposed) return;
        setPlan(fresh);
        if (!sameReviewedPlan(previous, fresh)) { setPicks(defaultInstallChoices(fresh)); setAcknowledged(false); return; }
        body = reviewApplyRequest(fresh, picks(), acknowledged());
        if (!body) return;
      }
      const ready = body;
      const result: ReviewOutcome = await serverCommand((api) => api.packInstallApply(area.id(), ready, intents.idFor(ready)));
      intents.settle();
      if (disposed) return;
      setOutcome(result);
      invalidateServerResources(area.id(), switchTo() ? [...CONTENT_RESOURCES, 'software', 'software-jobs'] : CONTENT_RESOURCES);
      void area.reload();
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setUncertain(intents.uncertain);
      if (!disposed) setError(reason as ServerCommandError);
    } finally { if (!disposed) setStage(null); }
  };

  const close = () => {
    if (stage() && !outcome()) return;
    // An uploaded file the review read but nobody linked is cancelled rather than abandoned.
    const uploadId = untrack(() => props.request.uploadId);
    if (uploadId && !untrack(outcome)) void serverCommand((api) => api.packUploadCancel(area.id(), uploadId, newIntentId())).catch(() => {});
    area.startInstall(null);
  };

  const notes = () => {
    const lines = [t(running() ? 'server-pack.review-note-restart' : 'server-pack.review-note-start')];
    if (area.clientMode() === 'server-modpack') lines.push(t('server-pack.review-note-players'));
    return lines.join(' · ');
  };
  const actionLabel = (): string => {
    if (stage() === 'backup') return t('server-pack.review-backing-up');
    if (stage() === 'install') return t('server-pack.review-installing');
    if (uncertain()) return t('server-pack.retry');
    return t(update() ? 'server-pack.review-update' : 'server-pack.review-install');
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }} closeLabel={t('nav.close')} size="lg" class="pack-review-dialog"
      title={<ReviewTitle source={source()} name={props.request.name} />}
      description={<ReviewSummary source={source()} />}
      footer={
        <Show when={!outcome()} fallback={
          <>
            <Button variant="ghost" onClick={() => { area.startInstall(null); transitionTo(`/servers/${area.id()}/resources`); }}>{t('server-pack.link-open-resources')}</Button>
            <span data-vesta="server-toolbar-spacer" />
            <Show when={running() && lifecycleControls(area.snapshot()).restart}>
              <Button variant="outline" icon={<Icon name="icons/actions/reload" />} disabled={!!lifecycle.busy() || lifecycle.pending('restart')}
                onClick={() => void lifecycle.submit('restart')}>{t('server-pack.install-restart')}</Button>
            </Show>
            <Button tone="accent" onClick={() => area.startInstall(null)}>{t('server-pack.done')}</Button>
          </>
        }>
          <span data-vesta="pack-review-note">{notes()}</span>
          <Button variant="ghost" disabled={!!stage()} onClick={close}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={busy() || !request() || !!blocker() || (!!plan() && reviewEmpty(plan()!))}
            title={blocker() ? t(blocker()!) : undefined} onClick={() => void apply()}>
            {actionLabel()}
          </Button>
        </Show>
      }>
      <Show when={outcome()} fallback={
        <div data-vesta="pack-review">
          <VersionCard source={source()} onSource={setSource} plan={plan()} disabled={busy()} />
          <Show when={plan()} fallback={
            <div data-vesta="pack-review-loading">
              <Show when={!error()}>
                <Progress size="sm"
                  value={preparation()?.total ? Math.round(preparation()!.completed / preparation()!.total * 100) : undefined}
                  label={t(preparation() ? stageLabel[preparation()!.stage] : 'server-pack.install-planning')} />
              </Show>
              <ServerErrorNote error={error()} onRetry={() => void planNow()} />
            </div>
          }>
            {(value) => (
              <>
                <Show when={switchTo()}>
                  {(change) => (
                    <div data-vesta="pack-review-switch" data-acknowledged={acknowledged() ? '' : undefined}>
                      <p>
                        <Icon name="icons/controls/warning" size={14} />
                        <strong>{t('server-pack.review-switch', { target: runtimeLabel(change().to) })}</strong>
                        <Show when={change().from}>{(from) => <small>{t('server-pack.review-switch-current', { current: runtimeLabel(from()) })}</small>}</Show>
                      </p>
                      <Checkbox size="sm" checked={acknowledged()} disabled={busy()} onChange={setAcknowledged} label={t('server-pack.review-switch-ack')} />
                    </div>
                  )}
                </Show>
                <Show when={!value().valid}><p data-vesta="server-callout" data-tone="danger" role="alert">{t('server-pack.install-invalid')}</p></Show>
                <ChangeSummary plan={value()} picks={picks()} disabled={busy()}
                  onPick={(path, choice) => setPicks((currentPicks) => ({ ...currentPicks, [path]: choice }))} />
                <Show when={value().warnings.length}>
                  <details data-vesta="pack-review-notes">
                    <summary>{t('server-pack.install-notes', { count: value().warnings.length })}</summary>
                    <ul><For each={value().warnings}>{(warning) => <li>{installWarning(warning, t)}</li>}</For></ul>
                  </details>
                </Show>
                <Show when={backupProfile() && !backedUp()}>
                  <Checkbox size="sm" checked={backupFirst()} disabled={busy()} onChange={setBackupFirst} label={t('server-pack.review-backup-first')} />
                </Show>
                <Show when={backupFailed()}><p data-vesta="server-callout" data-tone="warning" role="alert">{t('server-pack.review-backup-failed')}</p></Show>
                <Show when={stage() === 'backup'}><Progress size="sm" label={t('server-pack.review-backing-up')} /></Show>
                <Show when={uncertain()}><p data-vesta="server-callout" data-tone="warning">{t('server-pack.install-uncertain')}</p></Show>
                <ServerErrorNote error={error()} />
              </>
            )}
          </Show>
        </div>
      }>
        {(result) => (
          <div data-vesta="modpack-install-done" role="status">
            <span data-vesta="modpack-done-mark"><Icon name="icons/controls/check" size={20} /></span>
            <h4>{t('server-pack.install-staged', { count: result().pendingIds.length })}</h4>
            <p>{t(running() ? 'server-pack.install-staged-running' : 'server-pack.install-staged-stopped')}</p>
            <Show when={result().softwareJobId ? switchTo() : null}>{(change) => <p>{t('server-pack.review-switch-started', { target: runtimeLabel(change().to) })}</p>}</Show>
            <Show when={!update()}><OfferToPlayers /></Show>
          </div>
        )}
      </Show>
    </Dialog>
  );
}

/** Pack art, name and source tag in one line: the dialog's title. */
function ReviewTitle(props: { source: PackInstallSource; name: string }) {
  const area = useModpackArea();
  const provider = () => linkProvider(props.source);
  createEffect(() => { const value = provider(); return value ? `${value.provider}:${value.projectId}` : null; }, (key) => {
    const value = key ? linkProvider(untrack(() => props.source)) : null;
    if (value) void loadProject(value.provider, value.projectId).catch(() => {});
  }, { name: 'pack-review:project' });
  const project = () => { const value = provider(); return value ? peekProject(value.provider, value.projectId) : undefined; };
  const kind = () => linkSourceKind(props.source);
  const name = () => project()?.name ?? (props.name || t('server-pack.untitled'));
  const icon = () => project()?.icon_url ?? serverArt(`${area.snapshot().connection.serverId}:review:${name()}`, initials(name()));
  const sourceName = () => (kind() === 'modrinth' || kind() === 'curseforge' ? sourceById(kind() as 'modrinth' | 'curseforge').label : t(linkSourceLabel[kind() as 'upload' | 'vesta']));
  return (
    <span data-vesta="pack-review-title">
      <img src={icon()} alt="" width={36} height={36} draggable="false" />
      <span>{name()}</span>
      <span data-vesta="source-tag" data-source={kind()}>{sourceName()}</span>
    </span>
  );
}

/** One line from the provider's summary; nothing for uploads and Vesta packs. */
function ReviewSummary(props: { source: PackInstallSource }) {
  const summary = () => { const value = linkProvider(props.source); return value ? peekProject(value.provider, value.projectId)?.summary : undefined; };
  return <Show when={summary()}>{(text) => <span data-vesta="pack-review-summary" title={text()}>{text()}</span>}</Show>;
}

/**
 * The version as one row, like an instance's modpack card: the version (a dropdown for provider
 * packs), what the server runs now, the pack's runtime and its update state.
 */
function VersionCard(props: { source: PackInstallSource; onSource: (source: PackInstallSource) => void; plan: ReviewPlan | null; disabled: boolean }) {
  const area = useModpackArea();
  const provider = () => linkProvider(props.source);
  createEffect(() => { const value = provider(); return value ? `${value.provider}:${value.projectId}` : null; }, (key) => {
    const value = key ? linkProvider(untrack(() => props.source)) : null;
    if (value) void loadVersions(value.provider, value.projectId).catch(() => {});
  }, { name: 'pack-review:versions' });
  const versions = () => { const value = provider(); return value ? peekVersions(value.provider, value.projectId) ?? [] : []; };
  const installed = () => {
    const linked = linkProvider(area.link().installed?.source ?? null);
    const value = provider();
    return linked && value && linked.provider === value.provider && linked.projectId === value.projectId ? linked.versionId : null;
  };
  const versionName = (id: string | null) => (id ? versions().find((version) => version.id === id)?.version_number ?? id : '');
  /** Versions are newest first: a lower index than the installed one is an update. */
  const state = (): 'update' | 'installed' | 'older' | null => {
    const from = installed(), to = provider()?.versionId;
    if (!from || !to) return null;
    if (from === to) return 'installed';
    const list = versions().map((version) => version.id);
    const a = list.indexOf(to), b = list.indexOf(from);
    return a < 0 || b < 0 ? null : a < b ? 'update' : 'older';
  };
  const runtime = () => props.plan ? `${runtimeLabel({ software: props.plan.software, minecraftVersion: props.plan.minecraftVersion, loaderVersion: null })}${props.plan.loaderVersion ? ` · ${props.plan.loaderVersion}` : ''}` : '';
  return (
    <div data-vesta="pack-review-version">
      <Show when={provider()} fallback={<span data-vesta="pack-review-version-static"><small>{t('server-pack.review-version')}</small><strong>{t(linkSourceLabel[linkSourceKind(props.source) as 'upload' | 'vesta'])}</strong></span>}>
        {(value) => (
          <Select size="sm" aria-label={t('server-pack.review-version')} value={value().versionId} disabled={props.disabled || !versions().length}
            onChange={(versionId: string) => { if (versionId && versionId !== value().versionId) props.onSource({ source: 'provider', provider: value().provider, projectId: value().projectId, versionId }); }}
            placeholder={versionName(value().versionId)}
            options={versions().map((version) => ({ value: version.id, label: version.version_number, description: `${version.game_versions.slice(0, 2).join(', ')} · ${version.loaders.join(', ')}` }))} />
        )}
      </Show>
      <span data-vesta="pack-review-version-meta">
        <Show when={installed()}>{(id) => <><span>{t('server-pack.review-installed', { version: versionName(id()) })}</span><span aria-hidden="true">·</span></>}</Show>
        <span>{runtime()}</span>
      </span>
      <Show when={state()}>
        {(value) => (
          <Badge size="sm" variant="soft" tone={value() === 'update' ? 'accent' : value() === 'older' ? 'warning' : 'neutral'}>
            {t(value() === 'update' ? 'server-pack.review-badge-update' : value() === 'older' ? 'server-pack.review-badge-older' : 'server-pack.review-badge-installed')}
          </Badge>
        )}
      </Show>
    </div>
  );
}

/** Counts as chips that expand into their lists; conflicts are listed inline with replace / keep. */
function ChangeSummary(props: { plan: ReviewPlan; picks: Record<string, ConflictChoice>; disabled: boolean; onPick: (path: string, choice: ConflictChoice) => void }) {
  const [open, setOpen] = createSignal<ReviewCountKey | null>(null, { name: 'pack-review:open-group' });
  const groups = () => reviewCounts(props.plan);
  const conflicts = () => installConflicts(props.plan);
  const opened = () => groups().find((group) => group.key === open());
  const unchanged = () => props.plan.files.filter((file) => file.operation === 'unchanged').length;
  return (
    <section data-vesta="pack-review-changes" aria-label={t('server-pack.review-changes')}>
      <div data-vesta="pack-review-counts">
        <Show when={!reviewEmpty(props.plan)} fallback={<span data-vesta="server-muted">{t('server-pack.review-nothing')}</span>}>
          <For each={groups()}>
            {(group) => (
              <button type="button" data-vesta="pack-review-count" data-kind={group.key} aria-expanded={open() === group.key ? 'true' : 'false'}
                onClick={() => setOpen(open() === group.key ? null : group.key)}>
                <Icon name={countIcon[group.key]} size={12} />
                {t(countLabel[group.key], { count: group.paths.length })}
                <Icon name="icons/navigation/chevron-down" size={12} />
              </button>
            )}
          </For>
          <Show when={unchanged()}>
            <span data-vesta="pack-review-unchanged">{t('server-pack.review-unchanged', { count: unchanged() })}</span>
          </Show>
        </Show>
      </div>
      <Show when={opened()}>
        {(group) => (
          <ul data-vesta="modpack-install-list" data-kind={group().key}>
            <For each={group().paths}>{(path) => <li><code>{path}</code></li>}</For>
          </ul>
        )}
      </Show>
      <Show when={conflicts().length}>
        <div data-vesta="pack-review-conflicts">
          <h4><Icon name="icons/controls/warning" size={12} />{t('server-pack.review-conflicts', { count: conflicts().length })}</h4>
          <ul>
            <For each={conflicts()}>
              {(file) => (
                <li data-vesta="modpack-conflict">
                  <span><code>{file.path}</code><small>{t(conflictLabel[file.conflict!])}</small></span>
                  <SegmentedControl size="sm" aria-label={t('server-pack.install-conflict-choice', { path: file.path })} value={props.picks[file.path]} disabled={props.disabled}
                    onChange={(choice) => props.onPick(file.path, choice as ConflictChoice)}
                    options={[{ value: 'replace', label: t('server-pack.install-replace') }, { value: 'keep', label: t('server-pack.install-keep') }]} />
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </section>
  );
}

/**
 * After linking: players still get whatever the client pack says. Offer the same modpack to them
 * as a separate, explicit step (disabled until the agent delivers it).
 */
function OfferToPlayers() {
  const area = useModpackArea();
  const [busy, setBusy] = createSignal(false, { name: 'modpack-install:offer-busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-install:offer-error' });
  const option = () => offerToPlayers(area.workspace(), area.gates());
  const offer = async () => {
    setBusy(true); setError(null);
    try {
      await area.setClientMode('server-modpack');
      toast.show({ title: t('server-pack.mode-saved'), tone: 'success' });
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  return (
    <Show when={option()}>
      {(value) => (
        <div data-vesta="modpack-offer" data-disabled={value().enabled ? undefined : ''}>
          <span data-vesta="modpack-offer-copy">
            <strong>{t('server-pack.offer-title')}</strong>
            <span>{t(value().note === 'coming-soon' ? 'server-pack.mode-coming-soon' : 'server-pack.offer-description')}</span>
          </span>
          <Show when={value().note === 'coming-soon'}><Badge size="sm" variant="outline" tone="neutral">{t('server-pack.coming-soon')}</Badge></Show>
          <Button size="sm" variant="outline" disabled={!value().enabled || busy()} onClick={() => void offer()}>{t('server-pack.offer-action')}</Button>
          <ServerErrorNote error={error()} />
        </div>
      )}
    </Show>
  );
}
