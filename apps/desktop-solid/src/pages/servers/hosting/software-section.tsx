import { sameReviewedPlan } from '../../../features/servers/review-plan';
import { Button, Checkbox, Combobox, Dialog, Progress, SegmentedControl, Skeleton, toast } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { stableConnectionId } from '../../../features/servers/connection-id';
import {
  gameStopped, jobActive, jobPollDelay, jobStepMessage, launchSummary, reasonMessage, softwareName, softwareRestoreKind, warningCopy,
} from '../../../features/servers/hosting-model';
import type { SoftwareId, SoftwareJob, SoftwareLaunch, SoftwarePlan, SoftwareState } from '../../../features/servers/hosting-native';
import { compareGameVersions } from '../../../features/browse/browse-model';
import { IntentMemo } from '../../../features/servers/model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { invalidateServerResources, seedServerResource, useServerResource } from '../../../features/servers/resources';
import { javaInventoryResource, softwareJobsResource, softwareResource, softwareVersionsResource, softwareReleasesResource, warmSoftwareMetadata } from '../../../features/servers/server-resources';
import type { ServerJavaInventory } from '../../../features/servers/native-java';
import { isJavaJob, javaCompatibility, runtimeFor } from '../../../features/servers/server-java-model';
import {
  changeBlocker, initialChoice, keepMinecraft, latestVersionLabel, selectable, softwareIcon, softwareVersionKind,
  type SoftwareChoice,
} from '../../../features/servers/software-flow';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { SettingsPage, SettingsPanel } from '../settings-parts';
import { Hint, HostingError } from './parts';
import { JavaPanel, useJavaActions, type JavaActions } from './java-panel';
import { CustomJarPanel } from './custom-jar';
import { roleKey } from '../../../features/servers/capabilities';
import { launchKind } from '../../../features/servers/content-model';
import './hosting.css';

/** A custom JAR is shown as itself, never as a managed family. */
const launchText = (launch: SoftwareLaunch | null | undefined) => launch?.customJar?.path
  ? t('server-hosting.custom-jar-summary', { path: launch.customJar.path })
  : launchSummary(launch) ?? t('server-hosting.original-setup');

/** The software's mark on a tile tinted with its colour; a server glyph for the original setup. */
function SoftwareMark(props: { software: SoftwareId | null | undefined; size?: 'sm' | 'lg' }) {
  return (
    <span data-vesta="server-software-mark" data-software={props.software ?? 'original'} data-size={props.size ?? 'sm'} aria-hidden="true">
      <Icon name={props.software ? softwareIcon[props.software] : 'icons/content/server'} size={props.size === 'lg' ? 30 : 18} />
    </span>
  );
}

/** Settings → Software: what runs the server, switching it inline, and quietly going back. */
export function SoftwareSection(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const software = useServerResource(id, softwareResource);
  const jobs = useServerResource(id, softwareJobsResource);
  const java = useServerResource(id, javaInventoryResource);
  const [restoring, setRestoring] = createSignal(false, { name: 'server-software:restoring' });
  /** The job this view accepted or found running; its outcome is shown once it ends. */
  const [followed, setFollowed] = createSignal<string | null>(null, { name: 'server-software:followed' });
  const stopped = () => gameStopped(props.snapshot);
  const latest = () => jobs.value()?.[0];
  const busy = () => jobActive(latest());

  // Follow an accepted job until it ends: 2 s backing off to 10 s, only while this pane is open.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  onCleanup(() => { disposed = true; clearTimeout(timer); });
  const follow = (attempt = 0) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await jobs.refresh();
      if (disposed) return;
      if (jobActive(untrack(latest))) follow(attempt + 1);
      else {
        timer = undefined; void software.refresh(); void java.refresh();
        // The software decides which content kinds the server loads.
        invalidateServerResources(id(), ['content']);
      }
    }, jobPollDelay(attempt));
  };
  createEffect(busy, (active) => {
    if (!active || timer) return;
    setFollowed(untrack(latest)?.id ?? null);
    follow();
  }, { name: 'server-software:follow' });

  const accepted = (job: SoftwareJob) => {
    seedServerResource(id(), softwareJobsResource, [job, ...(jobs.value() ?? []).filter((entry) => entry.id !== job.id)]);
    setFollowed(job.id);
    follow();
  };
  const outcome = () => { const job = latest(); return job && job.id === followed() ? job : undefined; };
  const javaActions = useJavaActions(() => props.snapshot, accepted);

  return (
    <SettingsPage>
      <HostingError error={software.error()} onRetry={() => void software.refresh()} />
      <Show when={software.value()} fallback={<Show when={!software.error()}><Skeleton height={132} radius={12} /></Show>}>
        {(state) => (
          <>
            <Show when={!state().available}>
              <p data-vesta="server-callout" data-tone="warning">
                {t(reasonMessage(state().unavailableReason) ?? 'server-hosting.software-unavailable')}
              </p>
            </Show>
            <Show when={state().recoveryRequired}>
              <p data-vesta="server-callout" data-tone="danger">{t(softwareRestoreKind(state()) === 'launch' ? 'server-hosting.recover-launch-banner' : 'server-hosting.recovery-banner')}</p>
            </Show>
            {/* A custom JAR has no managed family to preselect; it shows as itself until restored. */}
            <Show when={stopped() && launchKind(state()).kind !== 'custom'} fallback={
              <SettingsPanel title={t('server-hosting.software-label')} name="software">
                <div data-vesta="server-software-installed">
                  <SoftwareMark software={state().current?.software} size="lg" />
                  <div><strong>{launchText(state().current)}</strong>
                    <Show when={java.value()?.selected}>{(runtime) => <p data-vesta="server-hosting-hint" style={{ display: 'flex', gap: 'var(--vesta-space-2)' }}><span>{runtime().vendor}</span><span>Java {runtime().major}</span></p>}</Show>
                  </div>
                </div>
              </SettingsPanel>
            }>
            <SettingsPanel title={t('server-hosting.software-label')} name="software">
              <For each={[state().current?.installationId ?? 'original']} keyed={(entry) => entry}>{() => <ChangeFlow snapshot={props.snapshot} state={state()} jobRunning={busy()} onAccepted={accepted} java={java.value()} javaActions={javaActions} />}</For>
            </SettingsPanel>
            </Show>
            <Show when={!props.snapshot.connection.role || roleKey(props.snapshot.connection.role) === 'owner'}>
              <CustomJarPanel snapshot={props.snapshot} state={state()} java={java.value()} jobRunning={busy()} onAccepted={accepted} />
            </Show>
            <SoftwareOutcome state={state()} job={isJavaJob(outcome()) ? undefined : outcome()} java={java.value()} busy={busy()} stopped={stopped()} onRestore={() => setRestoring(true)} />
            <Show when={stopped()}><JavaPanel snapshot={props.snapshot} inventory={java.value()} error={java.error()} loading={java.loading()} requiredMajor={state().current?.javaMajor ?? null}
              minecraft={state().current?.version ?? null} job={isJavaJob(outcome()) ? outcome() : undefined} jobRunning={busy()} actions={javaActions}
              onRefresh={() => void java.refresh()} /></Show>
          </>
        )}
      </Show>

      <Show when={restoring() ? software.value() : undefined}>
        {(state) => <RestoreDialog snapshot={props.snapshot} state={state()} onClose={() => setRestoring(false)} onAccepted={(job) => { setRestoring(false); accepted(job); }} />}
      </Show>
    </SettingsPage>
  );
}

/** Job feedback and the quiet, secondary rollback action. */
function SoftwareOutcome(props: { state: SoftwareState; job: SoftwareJob | undefined; java: ServerJavaInventory | undefined; busy: boolean; stopped: boolean; onRestore: () => void }) {
  const current = () => props.state.current;
  return (
    <Show when={props.job || softwareRestoreKind(props.state)}><section data-vesta="server-software-summary" data-server-software-current>
      <Show when={props.job}>{(job) => <JobStatus job={job()} current={current()} />}</Show>
      <Show when={softwareRestoreKind(props.state) ? props.state.previous : undefined}>
        {(previous) => (
          <footer data-vesta="server-software-previous">
            <Icon name="icons/content/history" size={13} />
            <Show when={props.state.available}>
              <button type="button" data-vesta="server-software-restore" disabled={!props.stopped || props.busy}
                title={!props.stopped ? t('server-hosting.stop-first') : undefined} onClick={() => props.onRestore()}>
                {t(softwareRestoreKind(props.state) === 'software' ? 'server-hosting.restore-previous' : 'server-hosting.recover-launch')}
              </button>
            </Show>
          </footer>
        )}
      </Show>
    </section></Show>
  );
}

function JobStatus(props: { job: SoftwareJob; current: SoftwareLaunch | null }) {
  return (
    <div data-vesta="server-hosting-job" data-state={props.job.state}>
      <Show when={jobActive(props.job)} fallback={
        <p data-vesta="server-callout" data-tone={props.job.state === 'succeeded' ? (props.job.warnings?.length ? 'warning' : 'success') : 'danger'}>
          {props.job.state === 'succeeded'
            ? t(props.job.warnings?.length ? 'server-hosting.job-succeeded-warning-now' : 'server-hosting.job-succeeded-now', { name: launchText(props.current) })
            : t(jobStepMessage[props.job.state])}
          <Show when={props.job.state !== 'succeeded' && reasonMessage(props.job.error)}>{(message) => <> {t(message())}</>}</Show>
        </p>
      }>
        {/* The agent reports steps, not amounts, so progress stays indeterminate. */}
        <Progress size="sm" label={t(jobStepMessage[props.job.state])} />
      </Show>
      <Show when={props.job.state === 'succeeded' && props.job.warnings?.length}>
        <ul data-vesta="server-hosting-warnings" role="status">
          <For each={props.job.warnings}>{(warning) => <li>{t(warningCopy(warning))}</li>}</For>
        </ul>
      </Show>
    </div>
  );
}

/** One labelled field of the change flow, laid out like the instance Versions tab. */
function Field(props: { label: string; aside?: JSX.Element; children: JSX.Element }) {
  return (
    <div data-vesta="server-software-field">
      <header><label>{props.label}</label>{props.aside}</header>
      {props.children}
    </div>
  );
}

/**
 * Inline change: software → Minecraft version → software version, then the agent's plan is
 * reviewed in place and applied. Same plan/apply contract and confirmations as before.
 */
export function ChangeFlow(props: {
  target?: { software: SoftwareId; version: string; loaderVersion: string | null };
  snapshot: ServerSnapshot; state: SoftwareState; jobRunning: boolean; onAccepted: (job: SoftwareJob) => void;
  java: ServerJavaInventory | undefined; javaActions: JavaActions;
}) {
  const id = stableConnectionId(() => props.snapshot);
  const now = useServersClock();
  const start = untrack(() => initialChoice(props.state.catalog, props.state.current, props.snapshot.info?.minecraftVersion || null));
  const [software, setSoftware] = createSignal<SoftwareId | null>(props.target?.software ?? start.software, { name: 'server-software:pick' });
  /** The Minecraft version asked for; the shown value falls back when the list lacks it. */
  const [wanted, setWanted] = createSignal<string | null>(props.target?.version ?? start.minecraft, { name: 'server-software:minecraft' });
  const [plan, setPlan] = createSignal<SoftwarePlan | null>(null, { name: 'server-software:plan' });
  const [acknowledged, setAcknowledged] = createSignal(false, { name: 'server-software:ack' });
  const [legacyAcknowledged, setLegacyAcknowledged] = createSignal(false, { name: 'server-software:ack-legacy' });
  const [busy, setBusy] = createSignal(false, { name: 'server-software:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-software:error' });
  const intents = new IntentMemo();
  const offered = () => props.state.catalog.some((entry) => entry.software === software() && selectable(entry));
  const versions = useServerResource(id, softwareVersionsResource, { args: () => software()!, enabled: () => !props.target && offered() });

  const versionList = () => versions.value()?.software === software() ? versions.value()?.versions : undefined;
  const minecraft = () => props.target?.version ?? (software() === start.software && wanted() === start.minecraft && start.minecraft
    ? start.minecraft : keepMinecraft(versionList(), wanted()));
  const releaseKey = () => software() + ':' + minecraft();
  const [pickedRelease, setPickedRelease] = createSignal<{ key: string; id: string } | null>(props.target?.loaderVersion ? { key: props.target.software + ':' + props.target.version, id: props.target.loaderVersion } : null, { name: 'server-software:release' });
  const installedRelease = () => props.state.current?.loaderVersion ?? (props.state.current?.build != null ? String(props.state.current.build) : 'latest');
  const selectedRelease = () => pickedRelease()?.key === releaseKey() ? pickedRelease()!.id
    : software() === start.software && minecraft() === start.minecraft ? installedRelease() : 'latest';
  const releaseArgs = createMemo(() => ({ software: software()!, version: minecraft()! }), { name: 'server-software:release-query' });
  const releases = useServerResource(id, softwareReleasesResource, { args: releaseArgs, enabled: () => !props.target && offered() && versionList() !== undefined && !versions.refreshing() && !!minecraft() && !!softwareVersionKind(software()) });
  const releaseList = () => releases.value()?.software === software() && releases.value()?.version === minecraft() ? releases.value()?.releases ?? [] : [];
  const releaseOptions = createMemo(() => {
    const values = [...releaseList()].sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true })).map(value => ({ value: value.id, label: value.build !== null ? 'Build ' + value.build : value.id }));
    const selected = selectedRelease();
    if (selected !== 'latest' && !values.some(v => v.value === selected)) values.unshift({ value: selected, label: softwareVersionKind(software()) === 'build' ? 'Build ' + selected : selected });
    return [{ value: 'latest', label: t(latestVersionLabel(software()) ?? 'server-hosting.latest-build') }, ...values];
  }, { name: 'server-software:release-options' });
  const choice = (): SoftwareChoice => ({ software: software(), minecraft: minecraft() });
  const where = () => !choice().software || !choice().minecraft ? 'incomplete'
    : software() === start.software && minecraft() === start.minecraft && (!softwareVersionKind(software()) || selectedRelease() === installedRelease()) ? 'same' : 'changed';
  const blocker = () => changeBlocker({
    available: props.state.available, recoveryRequired: props.state.recoveryRequired,
    stopped: gameStopped(props.snapshot), jobRunning: props.jobRunning,
  });
  const reviewing = () => !!plan();
  // The editor is mounted only while Minecraft is stopped.
  const locked = () => !props.state.available || props.state.recoveryRequired || props.jobRunning || busy() || reviewing();

  const softwareOptions = createMemo(() => props.state.catalog.filter(selectable).map((entry) => ({
    value: entry.software,
    label: softwareName(entry.software)!,
    icon: <SoftwareMark software={entry.software} />,
  })), { name: 'server-software:options' });
  const minecraftOptions = createMemo(() => {
    const values = [...(versionList() ?? [])].sort((a, b) => compareGameVersions(b, a));
    const current = software() === start.software ? start.minecraft : null;
    return (current && !values.includes(current) ? [current, ...values] : values).map((value) => ({ value, label: value }));
  }, { name: 'server-software:mc-options' });
  const caution = () => props.state.catalog.find((entry) => entry.software === software())?.caution;
  const latestLabel = () => latestVersionLabel(software());

  const remaining = () => Math.max(0, Math.floor(((plan()?.expiresAtMs ?? 0) - now()) / 1000));
  const expired = () => !!plan() && remaining() === 0;
  const legacy = () => !!plan()?.warnings.includes('legacy_checksum');
  const otherWarnings = () => plan()?.warnings.filter((code) => code !== 'legacy_checksum') ?? [];
  const compat = () => (plan() ? javaCompatibility(plan()!) : null);
  const canApply = () => !!plan() && !busy() && gameStopped(props.snapshot) && compat()?.state !== 'incompatible'
    && (!plan()!.warnings.length || acknowledged()) && (!legacy() || legacyAcknowledged());

  const pick = (value: string) => { setSoftware(value as SoftwareId); setError(null); };
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  const warmOption = (target: EventTarget | null) => {
    clearTimeout(hoverTimer);
    const name = target instanceof Element ? target.closest('[data-vesta="segmented-item"]')?.querySelector('[data-software]')?.getAttribute('data-software') : null;
    const entry = props.state.catalog.find(entry => entry.software === name && selectable(entry));
    if (!entry) return;
    hoverTimer = setTimeout(() => {
      if (!versions.refreshing() && !releases.refreshing() && !locked()) void warmSoftwareMetadata(id(), entry.software, minecraft());
    }, 150);
  };
  onCleanup(() => clearTimeout(hoverTimer));
  const discard = () => {
    const reset = initialChoice(props.state.catalog, props.state.current, props.snapshot.info?.minecraftVersion || null);
    setSoftware(reset.software); setWanted(reset.minecraft); setPickedRelease(null); setPlan(null); setError(null);
  };
  const review = async () => {
    const chosen = software(); const chosenVersion = minecraft();
    if (!chosen || !chosenVersion) return;
    setBusy(true); setError(null);
    try {
      const release = selectedRelease();
      const kind = softwareVersionKind(chosen);
      setPlan(await serverCommand((client) => client.softwarePlan(id(), { software: chosen, version: chosenVersion,
        ...(release !== 'latest' && kind === 'build' ? { build: Number(release) } : {}),
        ...(release !== 'latest' && kind === 'loader' ? { loaderVersion: release } : {}),
      })));
      setAcknowledged(false); setLegacyAcknowledged(false);
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    let current = plan();
    if (!current || !canApply()) return;
    if (expired()) {
      const previous = current;
      const ack = acknowledged(); const legacyAck = legacyAcknowledged();
      setPlan(null);
      await review();
      current = plan();
      if (!current || !sameReviewedPlan(previous, current)) return;
      setAcknowledged(ack); setLegacyAcknowledged(legacyAck);
    }
    const payload = { planId: current.planId, ack: acknowledged(), legacy: legacyAcknowledged() };
    const intentId = intents.idFor(payload);
    setBusy(true); setError(null);
    try {
      const job = await serverCommand((client) => client.softwareApply(id(), payload.planId, payload.ack, payload.legacy, intentId));
      intents.settle();
      toast.show({ title: t('server-hosting.switch-accepted'), tone: 'neutral' });
      setPlan(null);
      props.onAccepted(job);
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      setError(failure);
      if (failure.code === 'confirmation_expired') setPlan(null);
    } finally { setBusy(false); }
  };

  return (
    <div data-vesta="server-software-flow" data-server-software-step={reviewing() ? 'review' : 'pick'}>
        <Show when={props.target}><p>{softwareName(software())} {minecraft()} {selectedRelease() === 'latest' ? '' : selectedRelease()}</p></Show>
        <Show when={!props.target}>
        <Field label={t('server-hosting.software-label')}>
          <div onPointerOver={(event) => { if (event.pointerType !== 'touch') warmOption(event.target); }} onPointerLeave={() => clearTimeout(hoverTimer)} onFocusIn={(event) => warmOption(event.target)}>
          <SegmentedControl aria-label={t('server-hosting.software-label')} fill value={software() ?? undefined}
            options={softwareOptions()} onChange={pick} disabled={locked()} />
          </div>
          <Show when={caution()}><p data-vesta="server-hosting-hint">{t('server-hosting.warning-region-threading')}</p></Show>
        </Field>

        <div data-vesta="server-software-versions">
          <Field label={t('server-hosting.version-label')}>
            <Show when={!versions.loading() || versionList()} fallback={<Skeleton height={32} />}>
              <Combobox aria-label={t('server-hosting.version-label')} placeholder={t('server-hosting.version-placeholder')}
                options={minecraftOptions()} pageSize={80} value={minecraft() ?? undefined}
                onChange={setWanted} disabled={locked() || !minecraftOptions().length} />
            </Show>
          </Field>
          <Show when={latestLabel()}>
            {(_label) => (
              <Field label={t('server-hosting.software-version-label')}>
                <Combobox aria-label={t('server-hosting.software-version-label')} options={releaseOptions()} pageSize={80}
                  value={selectedRelease()} onChange={(value) => setPickedRelease({ key: releaseKey(), id: value })}
                  disabled={locked()} />
              </Field>
            )}
          </Show>
        </div>
        <Show when={software() === 'bukkit' || software() === 'spigot'}><p data-vesta="server-hosting-hint">{t('server-hosting.warning-source-build')}</p></Show>
        <HostingError error={releases.error()} onRetry={() => void releases.refresh()} />
        <HostingError error={versions.error()} onRetry={() => void versions.refresh()} />
        <Show when={versions.value() && !minecraftOptions().length}><p data-vesta="server-hosting-hint">{t('server-hosting.no-versions')}</p></Show>

        </Show>
        <Show when={!reviewing() && where() === 'changed'}>
          <div data-vesta="server-software-actions">
              <Button tone="accent" disabled={busy() || !!blocker()} onClick={() => void review()}>{t('server-hosting.review')}</Button>
              <Show when={!props.target}><Button variant="ghost" disabled={busy()} onClick={discard}>{t('server-hosting.discard')}</Button></Show>
            <Show when={busy()}><Progress size="sm" label={t('server-hosting.preparing')} /></Show>
          </div>
        </Show>
        <Show when={blocker()}>{(message) => <p data-vesta="server-hosting-hint" data-server-software-blocked>{t(message())}</p>}</Show>

      <Show when={plan()}>
        {(current) => (
          <section data-vesta="server-software-review" aria-label={t('server-hosting.review-title')}>
            <h4>{t('server-hosting.review-title')}</h4>
            <Show when={compat()}>{(java) => <JavaCompat compat={java()} inventory={props.java} actions={props.javaActions} locked={busy() || props.jobRunning} stopped={gameStopped(props.snapshot)} onReplan={() => void review()} />}</Show>
            <p data-vesta="server-callout" data-tone="warning">{t('server-hosting.backup-first')}</p>
            <Show when={otherWarnings().length || current().risks.length}>
              <ul data-vesta="server-hosting-warnings">
                <For each={otherWarnings()}>{(code) => <li>{t(warningCopy(code))}</li>}</For>
                <For each={current().risks}>{(code) => <li>{t(riskCopy(code))}</li>}</For>
              </ul>
            </Show>
            <Show when={current().warnings.length}>
              <Checkbox checked={acknowledged()} onChange={setAcknowledged} disabled={busy()} label={t('server-hosting.acknowledge')} />
            </Show>
            <Show when={legacy()}>
              <Checkbox checked={legacyAcknowledged()} onChange={setLegacyAcknowledged} disabled={busy()} label={t('server-hosting.warning-legacy-checksum')} />
            </Show>
            <Hint when={!gameStopped(props.snapshot)}>{t('server-hosting.stop-first')}</Hint>
            <div data-vesta="server-software-actions">
              <Button tone="accent" disabled={!canApply()} onClick={() => void apply()}>{t('server-hosting.apply')}</Button>
              <Button variant="ghost" disabled={busy()} onClick={() => { setPlan(null); setError(null); }}>{t('server-hosting.back')}</Button>

            </div>
          </section>
        )}
      </Show>
      <HostingError error={error()} />
    </div>
  );
}

/**
 * The plan's Java verdict. When the chosen software needs a Java this server doesn't use,
 * offer the installed runtime, or the agent's managed download, then plan again.
 */
function JavaCompat(props: {
  compat: ReturnType<typeof javaCompatibility>; inventory: ServerJavaInventory | undefined; actions: JavaActions;
  locked: boolean; stopped: boolean; onReplan: () => void;
}) {
  const installed = () => runtimeFor(props.inventory, props.compat.required);
  const usingIt = () => !!installed() && props.inventory?.selected?.id === installed()!.id;
  return (
    <div data-vesta="server-java-compat" data-state={props.compat.state}>
      <Icon name={props.compat.state === 'ok' ? 'icons/security/shield-check' : 'icons/status/info'} size={15} />
      <span data-vesta="server-java-compat-text">
        {props.compat.state === 'ok'
          ? t('server-java.compat-ok', { version: String(props.compat.required) })
          : props.compat.state === 'incompatible'
            ? props.compat.selected === null
              ? t('server-java.compat-none', { version: String(props.compat.required) })
              : t('server-java.compat-bad', { version: String(props.compat.required), found: String(props.compat.selected) })
            : t('server-hosting.java-needs', { version: String(props.compat.required) })}
      </span>
      <Show when={props.compat.state === 'incompatible'}>
        <Show when={installed()} fallback={
          <Show when={props.compat.download}>
            {(major) => (
              <Button size="sm" tone="accent" icon={<Icon name="icons/actions/download" />} disabled={props.locked} onClick={() => void props.actions.download(major())}>
                {t('server-java.download', { version: String(major()) })}
              </Button>
            )}
          </Show>
        }>
          {(runtime) => (
            <Show when={!usingIt()} fallback={<Button size="sm" variant="outline" disabled={props.locked} onClick={() => props.onReplan()}>{t('server-hosting.review-again')}</Button>}>
              <Button size="sm" tone="accent" disabled={props.locked || !props.stopped} onClick={() => void props.actions.select(runtime().id)}>
                {t('server-java.use-version', { version: String(runtime().major) })}
              </Button>
            </Show>
          )}
        </Show>
      </Show>
    </div>
  );
}

const risks: Record<string, Parameters<typeof t>[0]> = {
  cross_family_switch: 'server-hosting.risk-cross-family',
  world_upgrade: 'server-hosting.risk-world-upgrade',
  world_downgrade: 'server-hosting.risk-world-downgrade',
  mods_incompatible: 'server-hosting.risk-mods',
  plugins_incompatible: 'server-hosting.risk-plugins',
};
const riskCopy = (code: string) => risks[code] ?? 'server-hosting.warning-other';

/** Going back is a quiet, confirmed step: software only, the world stays as it is. */
function RestoreDialog(props: { snapshot: ServerSnapshot; state: SoftwareState; onClose: () => void; onAccepted: (job: SoftwareJob) => void }) {
  const [busy, setBusy] = createSignal(false, { name: 'server-software:restore-busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-software:restore-error' });
  const intents = new IntentMemo();
  const id = () => props.snapshot.connection.id;
  const restore = async () => {
    const intentId = intents.idFor({ revision: props.state.revision });
    setBusy(true); setError(null);
    try {
      const job = await serverCommand((client) => client.softwareRollback(id(), props.state.revision, intentId));
      intents.settle();
      props.onAccepted(job);
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      setError(failure);
    } finally { setBusy(false); }
  };
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(open) => { if (!open && !busy()) props.onClose(); }}
      title={softwareRestoreKind(props.state) === 'software' ? t('server-hosting.restore-title', { name: launchSummary(props.state.previous)! }) : t('server-hosting.restore-launch-title')}
      description={t(softwareRestoreKind(props.state) === 'software' ? 'server-hosting.restore-software-only' : 'server-hosting.restore-launch-only')}
      footer={
        <>
          <Button variant="ghost" disabled={busy()} onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={busy() || !gameStopped(props.snapshot)} onClick={() => void restore()}>{t(softwareRestoreKind(props.state) === 'software' ? 'server-hosting.restore' : 'server-hosting.recover-launch-action')}</Button>
        </>
      }
    >
      <div data-vesta="server-hosting-form">
        <Show when={softwareRestoreKind(props.state) === 'software'}><p data-vesta="server-hosting-hint">{t('server-hosting.restore-description', { name: launchText(props.state.current) })}</p></Show>
        <p data-vesta="server-callout" data-tone="warning">{t('server-hosting.restore-world-warning')}</p>
        <Hint when={!gameStopped(props.snapshot)}>{t('server-hosting.stop-first')}</Hint>
        <HostingError error={error()} />
      </div>
    </Dialog>
  );
}
