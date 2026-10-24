import { Badge, Button, Checkbox, Combobox, Dialog, Progress, SegmentedControl, Skeleton, toast } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { stableConnectionId } from '../../../features/servers/connection-id';
import {
  gameStopped, jobActive, jobPollDelay, jobStepMessage, launchSummary, reasonMessage, softwareName, warningCopy,
} from '../../../features/servers/hosting-model';
import type { SoftwareId, SoftwareJob, SoftwareLaunch, SoftwarePlan, SoftwareState } from '../../../features/servers/hosting-native';
import { IntentMemo } from '../../../features/servers/model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { seedServerResource, useServerResource } from '../../../features/servers/resources';
import { softwareJobsResource, softwareResource, softwareVersionsResource } from '../../../features/servers/server-resources';
import {
  changeBlocker, choiceState, initialChoice, keepMinecraft, latestVersionLabel, selectable, softwareIcon, softwareVersionKind,
  softwareVersionText, type SoftwareChoice,
} from '../../../features/servers/software-flow';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { SettingsPage, SettingsPanel } from '../settings-parts';
import { Hint, HostingError } from './parts';
import './hosting.css';

const launchText = (launch: SoftwareLaunch | null | undefined) => launchSummary(launch) ?? t('server-hosting.original-setup');

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
      else { timer = undefined; void software.refresh(); }
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

  return (
    <SettingsPage>
      <HostingError error={software.error()} onRetry={() => void software.refresh()} />
      <Show when={software.value()} fallback={<Show when={!software.error()}><Skeleton height={132} radius={12} /></Show>}>
        {(state) => (
          <>
            <SoftwareHero state={state()} job={outcome()} busy={busy()} stopped={stopped()} onRestore={() => setRestoring(true)} />
            <Show when={!state().available}>
              <p data-vesta="server-callout" data-tone="warning">
                {t(reasonMessage(state().unavailableReason) ?? 'server-hosting.software-unavailable')}
              </p>
            </Show>
            <Show when={state().recoveryRequired}>
              <p data-vesta="server-callout" data-tone="danger">{t('server-hosting.recovery-banner')}</p>
            </Show>
            <SettingsPanel title={t('server-hosting.change')} description={t('server-hosting.change-pick-description')} name="software">
              <ChangeFlow snapshot={props.snapshot} state={state()} jobRunning={busy()} onAccepted={accepted} />
            </SettingsPanel>
          </>
        )}
      </Show>

      <Show when={restoring() ? software.value() : undefined}>
        {(state) => <RestoreDialog snapshot={props.snapshot} state={state()} onClose={() => setRestoring(false)} onAccepted={(job) => { setRestoring(false); accepted(job); }} />}
      </Show>
    </SettingsPage>
  );
}

/** What runs now, as a rich card: mark, name, versions, Java, job progress and the quiet way back. */
function SoftwareHero(props: { state: SoftwareState; job: SoftwareJob | undefined; busy: boolean; stopped: boolean; onRestore: () => void }) {
  const current = () => props.state.current;
  const extra = () => softwareVersionText(current());
  return (
    <section data-vesta="server-software-hero" data-software={current()?.software ?? 'original'} data-server-software-current>
      <div data-vesta="server-software-hero-main">
        <SoftwareMark software={current()?.software} size="lg" />
        <div data-vesta="server-software-hero-copy">
          <span data-vesta="server-software-eyebrow">{t('server-hosting.current-software')}</span>
          <h2>{softwareName(current()?.software) ?? t('server-hosting.original-setup')}</h2>
          <p data-vesta="server-software-meta">
            <Show when={current()?.version} fallback={<span>{t('server-hosting.original-description')}</span>}>
              {(version) => <span>{t('server-hosting.minecraft-version', { version: version() })}</span>}
            </Show>
            <Show when={extra()}>{(text) => <><span aria-hidden="true">·</span><span>{text()}</span></>}</Show>
          </p>
        </div>
        {/* Java is information for now; the runtime picker (D5) takes this slot. */}
        <div data-vesta="server-software-java" data-server-software-java>
          <Show when={current()?.javaMajor}>
            {(major) => (
              <Badge tone="neutral" variant="outline">
                {t('server-hosting.java-version', { version: String(major()) })}
              </Badge>
            )}
          </Show>
        </div>
      </div>
      <Show when={props.job}>{(job) => <JobStatus job={job()} current={current()} />}</Show>
      <Show when={props.state.previous}>
        {(previous) => (
          <footer data-vesta="server-software-previous">
            <Icon name="icons/content/history" size={13} />
            <span>{t('server-hosting.previously', { name: launchText(previous()) })}</span>
            <Show when={props.state.available}>
              <span aria-hidden="true">·</span>
              <button type="button" data-vesta="server-software-restore" disabled={!props.stopped || props.busy}
                title={!props.stopped ? t('server-hosting.stop-first') : undefined} onClick={() => props.onRestore()}>
                {t('server-hosting.restore-previous')}
              </button>
            </Show>
          </footer>
        )}
      </Show>
    </section>
  );
}

function JobStatus(props: { job: SoftwareJob; current: SoftwareLaunch | null }) {
  return (
    <div data-vesta="server-hosting-job" data-state={props.job.state}>
      <Show when={jobActive(props.job)} fallback={
        <p data-vesta="server-callout" data-tone={props.job.state === 'succeeded' ? 'success' : 'danger'}>
          {props.job.state === 'succeeded'
            ? t('server-hosting.job-succeeded-now', { name: launchText(props.current) })
            : t(jobStepMessage[props.job.state])}
          <Show when={props.job.state !== 'succeeded' && reasonMessage(props.job.error)}>{(message) => <> {t(message())}</>}</Show>
        </p>
      }>
        {/* The agent reports steps, not amounts, so progress stays indeterminate. */}
        <Progress size="sm" label={t(jobStepMessage[props.job.state])} />
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
function ChangeFlow(props: { snapshot: ServerSnapshot; state: SoftwareState; jobRunning: boolean; onAccepted: (job: SoftwareJob) => void }) {
  const id = stableConnectionId(() => props.snapshot);
  const now = useServersClock();
  const start = untrack(() => initialChoice(props.state.catalog, props.state.current));
  const [software, setSoftware] = createSignal<SoftwareId | null>(start.software, { name: 'server-software:pick' });
  /** The Minecraft version asked for; the shown value falls back when the list lacks it. */
  const [wanted, setWanted] = createSignal<string | null>(start.minecraft, { name: 'server-software:minecraft' });
  const [plan, setPlan] = createSignal<SoftwarePlan | null>(null, { name: 'server-software:plan' });
  const [acknowledged, setAcknowledged] = createSignal(false, { name: 'server-software:ack' });
  const [legacyAcknowledged, setLegacyAcknowledged] = createSignal(false, { name: 'server-software:ack-legacy' });
  const [busy, setBusy] = createSignal(false, { name: 'server-software:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-software:error' });
  const intents = new IntentMemo();
  const versions = useServerResource(id, softwareVersionsResource, { args: () => software()!, enabled: () => !!software() });

  const versionList = () => versions.value()?.software === software() ? versions.value()?.versions : undefined;
  const minecraft = () => keepMinecraft(versionList(), wanted());
  const choice = (): SoftwareChoice => ({ software: software(), minecraft: minecraft() });
  const where = () => choiceState(choice(), props.state.current);
  const blocker = () => changeBlocker({
    available: props.state.available, recoveryRequired: props.state.recoveryRequired,
    stopped: gameStopped(props.snapshot), jobRunning: props.jobRunning,
  });
  const reviewing = () => !!plan();
  // Choosing stays open while Minecraft runs (like the instance Versions tab); only the
  // review needs it stopped. Unavailable software, recovery or a running job lock it.
  const locked = () => !props.state.available || props.state.recoveryRequired || props.jobRunning || busy() || reviewing();

  const softwareOptions = createMemo(() => props.state.catalog.map((entry) => ({
    value: entry.software,
    label: softwareName(entry.software)!,
    disabled: !selectable(entry),
    icon: <SoftwareMark software={entry.software} />,
  })), { name: 'server-software:options' });
  const notHere = () => props.state.catalog.filter((entry) => !selectable(entry)).map((entry) => softwareName(entry.software)).join(', ');
  const minecraftOptions = createMemo(() => (versionList() ?? []).map((value) => ({ value, label: value })), { name: 'server-software:mc-options' });
  const caution = () => props.state.catalog.find((entry) => entry.software === software())?.caution;
  const latestLabel = () => latestVersionLabel(software());

  const remaining = () => Math.max(0, Math.floor(((plan()?.expiresAtMs ?? 0) - now()) / 1000));
  const expired = () => !!plan() && remaining() === 0;
  const legacy = () => !!plan()?.warnings.includes('legacy_checksum');
  const otherWarnings = () => plan()?.warnings.filter((code) => code !== 'legacy_checksum') ?? [];
  const canApply = () => !!plan() && !expired() && !busy() && gameStopped(props.snapshot)
    && (!plan()!.warnings.length || acknowledged()) && (!legacy() || legacyAcknowledged());

  const pick = (value: string) => { setSoftware(value as SoftwareId); setError(null); };
  const discard = () => {
    const reset = initialChoice(props.state.catalog, props.state.current);
    setSoftware(reset.software); setWanted(reset.minecraft); setPlan(null); setError(null);
  };
  const review = async () => {
    const chosen = software(); const chosenVersion = minecraft();
    if (!chosen || !chosenVersion) return;
    setBusy(true); setError(null);
    try {
      setPlan(await serverCommand((client) => client.softwarePlan(id(), { software: chosen, version: chosenVersion })));
      setAcknowledged(false); setLegacyAcknowledged(false);
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    const current = plan();
    if (!current || !canApply()) return;
    const payload = { planId: current.planId, ack: acknowledged(), legacy: legacyAcknowledged() };
    const intentId = intents.idFor(payload);
    setBusy(true); setError(null);
    try {
      const job = await serverCommand((client) => client.softwareApply(id(), current.planId, payload.ack, payload.legacy, intentId));
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
      <Show when={!reviewing()}>
        <Field label={t('server-hosting.software-label')}>
          <SegmentedControl aria-label={t('server-hosting.software-label')} fill value={software() ?? undefined}
            options={softwareOptions()} onChange={pick} disabled={locked()} />
          <Show when={notHere()}>{(names) => <p data-vesta="server-hosting-hint">{t('server-hosting.not-set-up-here', { name: names() })}</p>}</Show>
          <Show when={caution()}><p data-vesta="server-hosting-hint">{t('server-hosting.warning-region-threading')}</p></Show>
        </Field>

        <div data-vesta="server-software-versions">
          <Field label={t('server-hosting.version-label')}>
            <Show when={!versions.loading() || versionList()} fallback={<Skeleton height={32} />}>
              <Combobox aria-label={t('server-hosting.version-label')} placeholder={t('server-hosting.version-placeholder')}
                options={minecraftOptions()} maxOptions={80} value={minecraft() ?? undefined}
                onChange={setWanted} disabled={locked() || !minecraftOptions().length} />
            </Show>
          </Field>
          <Show when={latestLabel()}>
            {(label) => (
              <Field label={t('server-hosting.software-version-label')}>
                <div data-vesta="server-software-fixed">
                  <span>{t(label())}</span>
                </div>
              </Field>
            )}
          </Show>
        </div>
        <Show when={latestLabel()}><p data-vesta="server-hosting-hint">{t('server-hosting.software-version-hint')}</p></Show>
        <HostingError error={versions.error()} onRetry={() => void versions.refresh()} />
        <Show when={versions.value() && !minecraftOptions().length}><p data-vesta="server-hosting-hint">{t('server-hosting.no-versions')}</p></Show>

        <Show when={where() === 'changed' || (where() === 'same' && softwareVersionKind(software()) && !blocker())}>
          <div data-vesta="server-software-actions">
            <Show when={where() === 'changed'} fallback={
              <Button variant="outline" disabled={busy()} icon={<Icon name="icons/actions/refresh" size={14} />} onClick={() => void review()}>
                {t('server-hosting.check-newer')}
              </Button>
            }>
              <Button tone="accent" disabled={busy() || !!blocker()} onClick={() => void review()}>{t('server-hosting.review')}</Button>
              <Button variant="ghost" disabled={busy()} onClick={discard}>{t('server-hosting.discard')}</Button>
            </Show>
            <Show when={busy()}><Progress size="sm" label={t('server-hosting.preparing')} /></Show>
          </div>
        </Show>
        <Show when={blocker()}>{(message) => <p data-vesta="server-hosting-hint" data-server-software-blocked>{t(message())}</p>}</Show>
      </Show>

      <Show when={plan()}>
        {(current) => (
          <section data-vesta="server-software-review" aria-label={t('server-hosting.review-title')}>
            <h4>{t('server-hosting.review-title')}</h4>
            <div data-vesta="server-software-compare">
              <div data-vesta="server-software-side">
                <span>{t('server-hosting.from')}</span>
                <div><SoftwareMark software={props.state.current?.software} /><strong>{launchText(props.state.current)}</strong></div>
              </div>
              <Icon name="icons/navigation/arrow-forward" size={16} />
              <div data-vesta="server-software-side" data-to>
                <span>{t('server-hosting.to')}</span>
                <div>
                  <SoftwareMark software={current().software} />
                  <strong>{launchSummary({ software: current().software, version: current().version, build: current().build, installationId: '' })}</strong>
                </div>
              </div>
            </div>
            <p data-vesta="server-hosting-hint">{t('server-hosting.java-needs', { version: String(current().java.major) })}</p>
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
              <Show when={!expired()} fallback={
                <Button tone="accent" disabled={busy()} onClick={() => void review()}>{t('server-hosting.review-again')}</Button>
              }>
                <Button tone="accent" disabled={!canApply()} onClick={() => void apply()}>{t('server-hosting.apply')}</Button>
              </Show>
              <Button variant="ghost" disabled={busy()} onClick={() => { setPlan(null); setError(null); }}>{t('server-hosting.back')}</Button>
              <span data-vesta="server-hosting-hint">
                {expired() ? t('server-hosting.review-expired') : t('server-hosting.review-expires', { count: remaining() })}
              </span>
            </div>
          </section>
        )}
      </Show>
      <HostingError error={error()} />
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
      title={t('server-hosting.restore-title', { name: launchText(props.state.previous) })}
      description={t('server-hosting.restore-software-only')}
      footer={
        <>
          <Button variant="ghost" disabled={busy()} onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={busy() || !gameStopped(props.snapshot)} onClick={() => void restore()}>{t('server-hosting.restore')}</Button>
        </>
      }
    >
      <div data-vesta="server-hosting-form">
        <p data-vesta="server-hosting-hint">{t('server-hosting.restore-description', { name: launchText(props.state.current) })}</p>
        <p data-vesta="server-callout" data-tone="warning">{t('server-hosting.restore-world-warning')}</p>
        <Hint when={!gameStopped(props.snapshot)}>{t('server-hosting.stop-first')}</Hint>
        <HostingError error={error()} />
      </div>
    </Dialog>
  );
}
