import { Button, Checkbox, Dialog, Progress, Select, Skeleton, toast } from '@vesta/ui';
import { For, Show, createEffect, createSignal, onCleanup, untrack } from 'solid-js';
import { SettingRow } from '../../../components/setting-row';
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
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { SettingsPage, SettingsPanel } from '../settings-parts';
import { Hint, HostingError } from './parts';
import './hosting.css';

const launchText = (launch: SoftwareLaunch | null | undefined) => launchSummary(launch) ?? t('server-hosting.original-setup');

/** Settings → Software: what runs the server, switching it, and going back. */
export function SoftwareSection(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const software = useServerResource(id, softwareResource);
  const jobs = useServerResource(id, softwareJobsResource);
  const [changing, setChanging] = createSignal(false, { name: 'server-software:changing' });
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
      <SettingsPanel title={t('server-hosting.software')} description={t('server-hosting.software-help')} name="software">
        <HostingError error={software.error()} onRetry={() => void software.refresh()} />
        <Show when={software.value()} fallback={<Show when={!software.error()}><Skeleton height={150} radius={0} /></Show>}>
          {(state) => (
            <div data-vesta="settings-panel-body">
              <Show when={!state().available}>
                <p data-vesta="server-callout" data-tone="warning">
                  {t(reasonMessage(state().unavailableReason) ?? 'server-hosting.software-unavailable')}
                </p>
              </Show>
              <Show when={state().recoveryRequired}>
                <p data-vesta="server-callout" data-tone="danger">{t('server-hosting.recovery-banner')}</p>
              </Show>
              <SettingRow label={t('server-hosting.running')}>
                <span data-vesta="server-setting-value" data-server-software-current>{launchText(state().current)}</span>
              </SettingRow>
              <Show when={state().current?.javaMajor}>
                {(major) => (
                  <SettingRow label={t('server-hosting.java')}>
                    <span data-vesta="server-setting-value">{t('server-hosting.java-version', { version: String(major()) })}</span>
                  </SettingRow>
                )}
              </Show>
              <SettingRow label={t('server-hosting.change')} description={t('server-hosting.change-description')}>
                <Button size="sm" variant="outline" disabled={!state().available || !stopped() || busy() || state().recoveryRequired}
                  onClick={() => setChanging(true)}>{t('server-hosting.change-action')}</Button>
              </SettingRow>
              <Show when={state().previous}>
                {(previous) => (
                  <SettingRow label={t('server-hosting.previous')} description={launchText(previous())}>
                    <Button size="sm" variant="ghost" disabled={!state().available || !stopped() || busy()} onClick={() => setRestoring(true)}>
                      {t('server-hosting.restore-previous')}
                    </Button>
                  </SettingRow>
                )}
              </Show>
              <Hint when={state().available && !stopped()}>{t('server-hosting.stop-first')}</Hint>
              <Show when={outcome()}>{(job) => <JobStatus job={job()} current={state().current} />}</Show>
            </div>
          )}
        </Show>
      </SettingsPanel>

      <Show when={changing() ? software.value() : undefined}>
        {(state) => <ChangeDialog snapshot={props.snapshot} state={state()} onClose={() => setChanging(false)} onAccepted={(job) => { setChanging(false); accepted(job); }} />}
      </Show>
      <Show when={restoring() ? software.value() : undefined}>
        {(state) => <RestoreDialog snapshot={props.snapshot} state={state()} onClose={() => setRestoring(false)} onAccepted={(job) => { setRestoring(false); accepted(job); }} />}
      </Show>
    </SettingsPage>
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

type Step = 'pick' | 'review';

function ChangeDialog(props: { snapshot: ServerSnapshot; state: SoftwareState; onClose: () => void; onAccepted: (job: SoftwareJob) => void }) {
  const id = stableConnectionId(() => props.snapshot);
  const now = useServersClock();
  const firstAvailable = props.state.catalog.find((entry) => entry.automaticBackend && !entry.unavailableReason)?.software ?? null;
  const [software, setSoftware] = createSignal<SoftwareId | null>(untrack(() => props.state.current?.software) ?? firstAvailable, { name: 'server-software:pick' });
  const [version, setVersion] = createSignal<string | null>(null, { name: 'server-software:version' });
  const [step, setStep] = createSignal<Step>('pick', { name: 'server-software:step' });
  const [plan, setPlan] = createSignal<SoftwarePlan | null>(null, { name: 'server-software:plan' });
  const [acknowledged, setAcknowledged] = createSignal(false, { name: 'server-software:ack' });
  const [legacyAcknowledged, setLegacyAcknowledged] = createSignal(false, { name: 'server-software:ack-legacy' });
  const [busy, setBusy] = createSignal(false, { name: 'server-software:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-software:error' });
  const intents = new IntentMemo();
  const versions = useServerResource(id, softwareVersionsResource, { args: () => software()!, enabled: () => !!software() });

  const options = () => props.state.catalog.map((entry) => ({
    value: entry.software,
    label: softwareName(entry.software)!,
    description: entry.automaticBackend && !entry.unavailableReason ? undefined : t('server-hosting.software-not-automatic'),
    disabled: !entry.automaticBackend || !!entry.unavailableReason,
  }));
  const versionOptions = () => (versions.value()?.versions ?? []).map((value) => ({ value, label: value }));
  const caution = () => props.state.catalog.find((entry) => entry.software === software())?.caution;
  const remaining = () => Math.max(0, Math.floor(((plan()?.expiresAtMs ?? 0) - now()) / 1000));
  const expired = () => !!plan() && remaining() === 0;
  const legacy = () => !!plan()?.warnings.includes('legacy_checksum');
  const otherWarnings = () => plan()?.warnings.filter((code) => code !== 'legacy_checksum') ?? [];
  const canApply = () => !!plan() && !expired() && !busy() && gameStopped(props.snapshot)
    && (!plan()!.warnings.length || acknowledged()) && (!legacy() || legacyAcknowledged());

  const pick = (value: string) => { setSoftware(value as SoftwareId); setVersion(null); setError(null); };
  const review = async () => {
    const chosen = software(); const chosenVersion = version();
    if (!chosen || !chosenVersion) return;
    setBusy(true); setError(null);
    try {
      setPlan(await serverCommand((client) => client.softwarePlan(id(), { software: chosen, version: chosenVersion })));
      setAcknowledged(false); setLegacyAcknowledged(false);
      setStep('review');
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
      props.onAccepted(job);
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      setError(failure);
      if (failure.code === 'confirmation_expired') setPlan(null);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => { if (!open && !busy()) props.onClose(); }}
      title={t('server-hosting.change-title')}
      description={step() === 'pick' ? t('server-hosting.change-pick-description') : t('server-hosting.review-description')}
      footer={
        <Show when={step() === 'review'} fallback={
          <>
            <Button variant="ghost" disabled={busy()} onClick={props.onClose}>{t('common.cancel')}</Button>
            <Button tone="accent" disabled={busy() || !software() || !version()} onClick={() => void review()}>{t('server-hosting.review')}</Button>
          </>
        }>
          <Button variant="ghost" disabled={busy()} onClick={() => { setStep('pick'); setPlan(null); setError(null); }}>{t('server-hosting.back')}</Button>
          <Show when={plan() && !expired()} fallback={
            <Button tone="accent" disabled={busy()} onClick={() => void review()}>{t('server-hosting.review-again')}</Button>
          }>
            <Button tone="accent" disabled={!canApply()} onClick={() => void apply()}>{t('server-hosting.apply')}</Button>
          </Show>
        </Show>
      }
    >
      <div data-vesta="server-hosting-form" data-server-software-step={step()}>
        <Show when={step() === 'pick'}>
          <Select size="sm" label={t('server-hosting.software-label')} value={software() ?? undefined} options={options()} onChange={pick} disabled={busy()} />
          <Show when={caution()}><p data-vesta="server-hosting-hint">{t('server-hosting.warning-region-threading')}</p></Show>
          <Show when={software()}>
            <Show when={!versions.loading()} fallback={<Skeleton height={32} />}>
              <Select size="sm" label={t('server-hosting.version-label')} placeholder={t('server-hosting.version-placeholder')}
                value={version() ?? undefined} options={versionOptions()} onChange={setVersion} disabled={busy() || !versionOptions().length} />
            </Show>
            <HostingError error={versions.error()} onRetry={() => void versions.refresh()} />
            <Show when={versions.value() && !versionOptions().length}><p data-vesta="server-hosting-hint">{t('server-hosting.no-versions')}</p></Show>
          </Show>
          <Show when={busy()}><Progress size="sm" label={t('server-hosting.preparing')} /></Show>
        </Show>

        <Show when={step() === 'review' ? plan() : undefined}>
          {(current) => (
            <>
              <dl data-vesta="server-hosting-review">
                <dt>{t('server-hosting.from')}</dt><dd>{launchText(props.state.current)}</dd>
                <dt>{t('server-hosting.to')}</dt>
                <dd>{launchSummary({ software: current().software, version: current().version, build: current().build, installationId: '' })}</dd>
                <dt>{t('server-hosting.java')}</dt><dd>{t('server-hosting.java-needs', { version: String(current().java.major) })}</dd>
              </dl>
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
              <p data-vesta="server-hosting-hint">
                {expired() ? t('server-hosting.review-expired') : t('server-hosting.review-expires', { count: remaining() })}
              </p>
            </>
          )}
        </Show>
        <Hint when={!gameStopped(props.snapshot)}>{t('server-hosting.stop-first')}</Hint>
        <HostingError error={error()} />
      </div>
    </Dialog>
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
      description={t('server-hosting.restore-description', { name: launchText(props.state.current) })}
      footer={
        <>
          <Button variant="ghost" disabled={busy()} onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={busy() || !gameStopped(props.snapshot)} onClick={() => void restore()}>{t('server-hosting.restore')}</Button>
        </>
      }
    >
      <div data-vesta="server-hosting-form">
        <p data-vesta="server-callout" data-tone="warning">{t('server-hosting.restore-world-warning')}</p>
        <Hint when={!gameStopped(props.snapshot)}>{t('server-hosting.stop-first')}</Hint>
        <HostingError error={error()} />
      </div>
    </Dialog>
  );
}
