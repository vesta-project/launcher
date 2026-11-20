import { Metadata } from '../../../components/metadata';
import { sameReviewedPlan } from '../../../features/servers/review-plan';
import { Badge, Button, Checkbox, Select, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { sourceById } from '../../../features/browse/browse-model';
import { loadProject, loadVersions, peekProject, peekVersions } from '../../../features/browse/browse-projects';
import { initials, serverArt } from '../../../features/servers/art';
import { gate } from '../../../features/servers/capabilities';
import { lifecycleControls, newIntentId } from '../../../features/servers/model';
import {
  defaultInstallChoices, installWarning, installDecision, linkProvider, linkSourceKind, linkSourceLabel, offerToPlayers,
  type ConflictChoice,
} from '../../../features/servers/modpack-area-model';
import {
  backupProfileFor, offerFreshWorld, planSoftwareSwitch, reviewApplyRequest, reviewBlocker, reviewEmpty, reviewWarnings, reviewNeedsWarningConsent, runtimeLabel, softwareName,
  type PackRuntime, type ReviewPlan,
} from '../../../features/servers/pack-install-review';
import type { ServerCommandError } from '../../../features/servers/native';
import type { PackInstallApply, PackInstallSource } from '../../../features/servers/native-pack';
import { isActivePhase } from '../../../features/servers/pack-install-job';
import { cancelInstall, dismissInstallResult, packInstallJob, packJobPhase, preparationCancelled, preparePlan, preparedPlan, runInstall } from '../../../features/servers/pack-install-store';
import { useServerResource } from '../../../features/servers/resources';
import { backupsResource, softwareResource, worldResource } from '../../../features/servers/server-resources';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { t } from '../../../localization';
import { useLifecycle } from '../lifecycle';
import { ServerErrorNote } from '../parts';
import { useModpackArea, type InstallRequestSource } from './area';
import { InstallJobProgress } from './install-job';

const sourceKey = (source: PackInstallSource) => JSON.stringify(source);

/**
 * Link or update the stopped server inline on its modpack page.
 * A required software switch is part of the install and needs one acknowledgement; changes are
 * reviewed without downloading payloads; backup and fresh-world selection are optional.
 *
 * Preparation and the install itself belong to the per-server job store: leaving this page or
 * switching servers neither restarts preparation nor loses a running install.
 */
export function InstallOnServerDialog(props: { request: InstallRequestSource }) {
  const area = useModpackArea();
  const now = useServersClock();
  const lifecycle = useLifecycle(area.snapshot);
  const software = useServerResource(() => area.id(), softwareResource);
  const caps = () => area.snapshot().capabilities;
  const backups = useServerResource(() => area.id(), backupsResource, { enabled: () => gate(caps(), 'backups.create') === 'allowed' });
  const job = () => packInstallJob(area.id());
  const phase = () => packJobPhase(area.id());
  const [source, setSource] = createSignal<PackInstallSource>(untrack(() => props.request.source), { name: 'pack-review:source' });
  const [plan, setPlan] = createSignal<ReviewPlan | null>(null, { name: 'pack-review:plan' });
  const [picks, setPicks] = createSignal<Record<string, ConflictChoice>>({}, { name: 'pack-review:picks' });
  const [acknowledged, setAcknowledged] = createSignal(false, { name: 'pack-review:acknowledged' });
  const [warningsAcknowledged, setWarningsAcknowledged] = createSignal(false, { name: 'pack-review:warnings-acknowledged' });
  const [backupFirst, setBackupFirst] = createSignal(false, { name: 'pack-review:backup-first' });
  const world = useServerResource(() => area.id(), worldResource, { enabled: () => gate(caps(), 'config.view') === 'allowed' });
  const [resetWorld, setResetWorld] = createSignal<{name: string; revision: string} | null>(null, { name: 'pack-review:reset-world' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'pack-review:error' });
  const canResetWorld = () => area.snapshot().connection.role === 'owner' && !!plan() && offerFreshWorld(!!world.value()?.exists, area.link().installed?.source ?? null, source(), current()?.minecraftVersion, plan()?.minecraftVersion);
  let disposed = false;
  let sequence = 0;
  onCleanup(() => { disposed = true; });
  const planning = () => phase() === 'preparing';
  const busy = () => isActivePhase(phase());
  /** The finished install this review started; shown until Done. */
  const outcome = () => (phase() === 'succeeded' ? job().outcome : null);
  const stopped = () => area.snapshot().status?.state === 'stopped' && !['starting', 'waking'].includes(area.snapshot().status?.lifecycle ?? '');

  const acceptPlan = (value: ReviewPlan) => {
    setPlan(value); setAcknowledged(false); setWarningsAcknowledged(false);
    setPicks(defaultInstallChoices(value));
  };
  /** Reattaches to a preparation already running (or finished) for this source. */
  const planNow = async (fresh = false): Promise<void> => {
    const request = ++sequence;
    const target = untrack(source);
    const ready = fresh ? undefined : preparedPlan(area.id(), target);
    if (ready) { acceptPlan(ready); return; }
    const startedRevision = untrack(() => software.value()?.revision);
    setError(null); setPlan(null); setAcknowledged(false);
    try {
      const value = await preparePlan(area.id(), target, { fresh });
      if (disposed || request !== sequence) return;
      if (startedRevision !== undefined && startedRevision !== untrack(() => software.value()?.revision)) return planNow(true);
      acceptPlan(value);
    } catch (reason) {
      if (!disposed && request === sequence && !preparationCancelled(reason)) setError(reason as ServerCommandError);
    }
  };
  // Selecting a version reads runtime metadata; archive analysis waits for Install.
  createEffect(() => sourceKey(source()), () => { setResetWorld(null); if (!untrack(outcome)) void planNow(); }, { name: 'pack-review:plan-source' });
  let softwareRevision: string | undefined;
  createEffect(() => software.value()?.revision, revision => {
    const previous = softwareRevision; softwareRevision = revision;
    if (previous !== undefined && revision !== previous && !untrack(busy) && !untrack(outcome)) setPlan(null);
  }, { name: 'pack-review:software-revision' });

  const current = (): PackRuntime | null => {
    const launch = software.value()?.current;
    return launch?.software && launch.version ? { software: launch.software, minecraftVersion: launch.version, loaderVersion: launch.loaderVersion ?? null } : null;
  };
  const switchTo = () => { const value = plan(); return value ? planSoftwareSwitch(value, current()) : null; };
  const blocker = () => { const value = plan(); return value ? reviewBlocker(value, acknowledged()) : null; };
  const request = createMemo<PackInstallApply | null>(() => { const value = plan(); return value ? reviewApplyRequest(value, picks(), acknowledged(), warningsAcknowledged()) : null; }, { name: 'pack-review:request' });
  const update = () => props.request.mode === 'update';
  const running = () => area.snapshot().status?.state === 'running';
  const backupProfile = () => backupProfileFor(backups.value()?.profiles ?? [], running());

  const apply = async () => {
    if (!stopped() || busy()) return;
    if (!plan()) {
      await planNow();
      if (disposed || !plan()) return;
    }
    let reviewed = plan()!;
    // Plans don't expire for the person: re-plan quietly and only stop if what changes differs.
    if (reviewed.expiresAtMs <= now()) {
      try {
        const fresh = await preparePlan(area.id(), untrack(source), { fresh: true });
        if (disposed) return;
        setPlan(fresh);
        if (!sameReviewedPlan(reviewed, fresh)) { setPicks(defaultInstallChoices(fresh)); setAcknowledged(false); setWarningsAcknowledged(false); return; }
        reviewed = fresh;
      } catch (reason) { if (!disposed && !preparationCancelled(reason)) setError(reason as ServerCommandError); return; }
    }
    const body = reviewApplyRequest(reviewed, picks(), acknowledged(), warningsAcknowledged());
    if (!body || blocker() || (reviewNeedsWarningConsent(reviewed) && !warningsAcknowledged())) return;
    setError(null);
    const profile = backupFirst() ? backupProfile() : null;
    void runInstall(area.id(), { body, backupProfile: profile ?? null, resetWorld: untrack(resetWorld), softwareSwitch: !!switchTo() });
  };

  const close = () => {
    if (busy() && !planning()) return;
    if (planning()) { cancelInstall(area.id()); return; }
    // An uploaded file the review read but nobody linked is cancelled rather than abandoned.
    const uploadId = untrack(() => props.request.uploadId);
    if (uploadId && !untrack(outcome)) void serverCommand((api) => api.packUploadCancel(area.id(), uploadId, newIntentId())).catch(() => {});
    area.startInstall(null);
  };
  const done = () => dismissInstallResult(area.id());

  return (
    <InlineInstall
      title={<ReviewTitle source={source()} name={props.request.name} />}
      description={<ReviewSummary source={source()} />}
      footer={
        <Show when={!outcome()} fallback={
          <>
            <Button variant="ghost" onClick={() => { done(); transitionTo(`/servers/${area.id()}/resources`); }}>{t('server-pack.link-open-resources')}</Button>
            <span data-vesta="server-toolbar-spacer" />
            <Show when={running() && lifecycleControls(area.snapshot()).restart}>
              <Button variant="outline" icon={<Icon name="icons/actions/reload" />} disabled={!!lifecycle.busy() || lifecycle.pending('restart')}
                onClick={() => void lifecycle.submit('restart')}>{t('server-pack.install-restart')}</Button>
            </Show>
            <Button tone="accent" onClick={done}>{t('server-pack.done')}</Button>
          </>
        }>
          <span data-vesta="pack-review-note">{!stopped() ? t('server-pack.stop-to-install') : ''}</span>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={busy() || !stopped() || (!!plan() && !request()) || !!blocker() || (!!plan() && reviewEmpty(plan()!)) || (!!plan() && reviewNeedsWarningConsent(plan()!) && !warningsAcknowledged())}
            data-tip={!stopped() ? t('server-pack.stop-to-install') : blocker() ? t(blocker()!) : undefined} onClick={() => void apply()}>
            {t(update() ? 'server-pack.review-update' : 'server-pack.review-install')}
          </Button>
        </Show>
      }>
      <Show when={outcome()} fallback={
        <div data-vesta="pack-review">
          <VersionCard source={source()} onSource={setSource} plan={plan()} disabled={busy() || !stopped()} />
          <Show when={plan()} fallback={
            <div data-vesta="pack-review-loading">
              <InstallJobProgress serverId={area.id()} />
              <ServerErrorNote error={error()} onRetry={() => void planNow(true)} />
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
                        <Show when={change().from}>{(from) => <small>{t('server-pack.review-switch-current', { source: runtimeLabel(from()) })}</small>}</Show>
                      </p>
                      <Checkbox size="sm" checked={acknowledged()} disabled={busy()} onChange={value => { setAcknowledged(value); setWarningsAcknowledged(value); }} label={t('server-pack.review-switch-ack')} />
                    </div>
                  )}
                </Show>
                <Show when={!value().valid}><p data-vesta="server-callout" data-tone="danger" role="alert">{t('server-pack.install-invalid')}</p></Show>
                <Show when={canResetWorld() || resetWorld()}>
                  <Checkbox size="sm" checked={!!resetWorld()} disabled={busy()} onChange={checked => setResetWorld(checked && world.value() ? {name: world.value()!.name, revision: world.value()!.revision} : null)} label={t('server-pack.reset-world')} />
                  <Show when={resetWorld()}><p data-vesta="server-muted">{t('server-pack.reset-world-description')}</p></Show>
                </Show>
                <Show when={reviewWarnings(value()).length}>
                  <details data-vesta="pack-review-notes">
                    <summary>{t('server-pack.install-notes', { count: reviewWarnings(value()).length })}</summary>
                    <ul><For each={reviewWarnings(value())}>{(warning) => <li>{installWarning(warning, t)}</li>}</For></ul>
                  </details>
                  <Show when={!switchTo() && reviewNeedsWarningConsent(value())}><Checkbox size="sm" checked={warningsAcknowledged()} disabled={busy()} onChange={setWarningsAcknowledged} label={t('server-pack.review-warnings-ack')} /></Show>
                </Show>
                <Show when={backupProfile()}>
                  <Checkbox size="sm" checked={backupFirst()} disabled={busy()} onChange={setBackupFirst} label={t('server-pack.review-backup-first')} />
                </Show>
                <InstallJobProgress serverId={area.id()} />
                <ServerErrorNote error={error()} />
              </>
            )}
          </Show>
        </div>
      }>
        {(result) => (
          <div data-vesta="modpack-install-done" role="status">
            <span data-vesta="modpack-done-mark"><Icon name="icons/controls/check" size={20} /></span>
            <h4>{t('server-pack.install-complete')}</h4>
            <Show when={result().decisions?.length}><details><summary>{t('server-pack.show-changes')}</summary><ul><For each={result().decisions}>{decision => <li>{installDecision(decision, t)}</li>}</For></ul></details></Show>
            <Show when={!update()}><OfferToPlayers /></Show>
          </div>
        )}
      </Show>
    </InlineInstall>
  );
}

/**
 * The dialog's title: pack art beside the name and source tag, with the provider's one-line
 * summary under the name. The summary is read once, as the dialog's description.
 */
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
    <span data-vesta="pack-review-title" data-summary={project()?.summary ? '' : undefined}>
      <img src={icon()} alt="" width={40} height={40} draggable="false" />
      <span data-vesta="pack-review-name">
        <span>{name()}</span>
        <span data-vesta="source-tag" data-source={kind()}>{sourceName()}</span>
      </span>
      <Show when={project()?.summary}>
        {(text) => <span data-vesta="pack-review-summary" aria-hidden="true" data-tip-overflow>{text()}</span>}
      </Show>
    </span>
  );
}

/** The provider's summary for assistive technology; the title shows it under the name. */
function ReviewSummary(props: { source: PackInstallSource }) {
  const summary = () => { const value = linkProvider(props.source); return value ? peekProject(value.provider, value.projectId)?.summary : undefined; };
  return <Show when={summary()}>{(text) => <span>{text()}</span>}</Show>;
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
  /** The pack's runtime as separate facts: Minecraft, then the loader and its version. */
  const loader = () => (props.plan && props.plan.software !== 'vanilla' ? `${softwareName(props.plan.software)}${props.plan.loaderVersion ? ` ${props.plan.loaderVersion}` : ''}` : null);
  return (
    <div data-vesta="pack-review-version">
      <Show when={provider()} fallback={<span data-vesta="pack-review-version-static"><small>{t('server-pack.review-version')}</small><strong>{t(linkSourceLabel[linkSourceKind(props.source) as 'upload' | 'vesta'])}</strong></span>}>
        {(value) => (
          <Select size="sm" aria-label={t('server-pack.review-version')} value={value().versionId} disabled={props.disabled || !versions().length}
            onChange={(versionId: string) => { if (versionId && versionId !== value().versionId) props.onSource({ source: 'provider', provider: value().provider, projectId: value().projectId, versionId }); }}
            placeholder={versionName(value().versionId)}
            options={versions().map((version) => ({ value: version.id, label: version.version_number, description: <Metadata parts={[version.game_versions.slice(0, 2).join(', '), version.loaders.join(', ')]} /> }))} />
        )}
      </Show>
      <span data-vesta="pack-review-version-meta">
        <Show when={installed()}>{(id) => <span>{t('server-pack.review-installed', { version: versionName(id()) })}</span>}</Show>
        <Show when={props.plan}>{(value) => <span>{t('server-pack.minecraft', { version: value().minecraftVersion })}</span>}</Show>
        <Show when={loader()}>{(value) => <span>{value()}</span>}</Show>
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

/** Reuse the server panel layout for the install's version, progress and result. */
function InlineInstall(props: { title?: import('@solidjs/web').JSX.Element; description?: import('@solidjs/web').JSX.Element; footer?: import('@solidjs/web').JSX.Element; children?: import('@solidjs/web').JSX.Element; [key: string]: unknown }) {
  return <div data-vesta="modpack-scroll"><section data-vesta="modpack-panel"><header data-vesta="modpack-panel-head"><h3>{props.title}</h3></header><div data-vesta="modpack-panel-body">{props.children}<div data-vesta="modpack-card-actions">{props.footer}</div></div></section></div>;
}
