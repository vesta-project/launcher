import { Button, Progress } from '@vesta/ui';
import { For, Show, createMemo } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { linkProvider } from '../../../features/servers/modpack-area-model';
import { peekProject } from '../../../features/browse/browse-projects';
import {
  cancellablePhase, formatBytes, formatElapsed, isActivePhase, isQuiet, jobSteps, phaseLabel, progressView,
  type PackJobPhase,
} from '../../../features/servers/pack-install-job';
import {
  cancelInstall, dismissInstallResult, packInstallJob, packJobPhase, retryInstall,
} from '../../../features/servers/pack-install-store';
import { useServersClock } from '../../../features/servers/store';
import { installPackActivity } from '../../../features/servers/pack-install-activity';
import { formatNumber, t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';

// Installs start and are adopted from this UI, so the activity panel bridge loads with it.
installPackActivity();

/** Phases that replace the Server modpack section with this panel. */
const PANEL_PHASES: ReadonlySet<PackJobPhase> = new Set(['backing-up', 'installing', 'switching', 'resetting-world', 'failed', 'interrupted', 'recovery']);
export const showsJobPanel = (phase: PackJobPhase | null) => !!phase && PANEL_PHASES.has(phase);

/** The live stage, bar and counters. Shared by the review (while preparing) and the job panel. */
export function InstallJobProgress(props: { serverId: string; cancel?: boolean }) {
  const now = useServersClock();
  const job = () => packInstallJob(props.serverId);
  const phase = () => packJobPhase(props.serverId);
  const view = createMemo(() => { const value = phase(); return value && isActivePhase(value) ? progressView(value, job().progress) : null; }, { name: 'pack-job:progress' });
  const counter = () => {
    const value = view();
    if (!value) return '';
    const parts = [
      value.items ? `${formatNumber(value.items.completed)} / ${formatNumber(value.items.total)}` : '',
      value.bytes ? formatBytes(value.bytes) : '',
    ].filter(Boolean);
    return parts.join(' · ');
  };
  return (
    <Show when={view()}>
      {(value) => (
        <div data-vesta="pack-job-progress" role="status" aria-live="polite">
          <div data-vesta="pack-job-progress-line">
            <span data-vesta="pack-job-stage">{t(value().stage)}</span>
            <Show when={counter()}><span data-vesta="pack-job-counter">{counter()}</span></Show>
            <span data-vesta="pack-job-spacer" />
            <Show when={job().startedAt}>{(started) => <span data-vesta="pack-job-elapsed">{t('server-pack.job-elapsed', { time: formatElapsed(now() - started()) })}</span>}</Show>
          </div>
          <Progress size="sm" value={value().percent} aria-label={t(value().stage)} />
          <Show when={isQuiet(phase(), job().lastChangeAt, now())}><p data-vesta="pack-job-hint">{t('server-pack.job-quiet')}</p></Show>
          <Show when={props.cancel && cancellablePhase(phase())}>
            <div data-vesta="pack-job-inline-actions">
              <Button size="sm" variant="ghost" onClick={() => cancelInstall(props.serverId)}>{t('server-pack.job-cancel')}</Button>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

/**
 * The Server modpack section while an install runs or has just failed: what is installing, the
 * steps it will take, live progress, and what can still be done. Survives navigation and restarts
 * because everything it reads lives in the per-server job store.
 */
export function InstallJobPanel() {
  const area = useModpackArea();
  const job = () => packInstallJob(area.id());
  const phase = () => packJobPhase(area.id());
  const steps = createMemo(() => jobSteps(job().shape, phase(), job().failedAt), { name: 'pack-job:steps' });
  const active = () => isActivePhase(phase());
  const adopted = () => job().shape.adopted && !job().request;
  const name = () => job().request?.name;
  const icon = () => {
    const provider = linkProvider(job().request?.source ?? null);
    return (provider ? peekProject(provider.provider, provider.projectId)?.icon_url : undefined) ?? area.linkIcon();
  };
  const title = () => {
    const value = phase();
    if (!value) return '';
    if (active()) return name() ? t('server-pack.job-title', { name: name()! }) : t('server-pack.job-title-adopted');
    return t(phaseLabel(value));
  };
  const help = () => phase() === 'interrupted' ? t('server-pack.job-interrupted-help') : phase() === 'recovery' ? t('server-pack.job-recovery-help') : '';
  return (
    <div data-vesta="modpack-scroll">
      <section data-vesta="pack-job" data-phase={phase() ?? undefined}>
        <header data-vesta="pack-job-head">
          <img src={icon()} alt="" width={40} height={40} draggable="false" />
          <span data-vesta="pack-job-heading">
            <h3>{title()}</h3>
            <span data-vesta="pack-job-sub">{active() ? t(phaseLabel(phase()!)) : name() ?? ''}</span>
          </span>
          <Show when={!active()}>
            <span data-vesta="pack-job-mark" data-tone={phase() === 'succeeded' ? 'success' : phase() === 'interrupted' ? 'warning' : 'danger'}>
              <Icon name={phase() === 'succeeded' ? 'icons/controls/check' : 'icons/controls/warning'} size={16} />
            </span>
          </Show>
        </header>

        <ol data-vesta="pack-job-steps" aria-label={t('server-pack.job-phase-installing')}>
          <For each={steps()}>
            {(step) => (
              <li data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
                <span data-vesta="pack-job-step-mark" aria-hidden="true">
                  <Show when={step.state === 'done'}><Icon name="icons/controls/check" size={12} /></Show>
                  <Show when={step.state === 'failed'}><Icon name="icons/actions/close" size={12} /></Show>
                </span>
                <span>{t(step.label)}</span>
              </li>
            )}
          </For>
        </ol>

        <Show when={active()}>
          <InstallJobProgress serverId={area.id()} />
          <p data-vesta="pack-job-hint">
            {cancellablePhase(phase()) ? t('server-pack.job-leave') : `${t('server-pack.job-no-cancel')} ${t('server-pack.job-leave')}`}
          </p>
        </Show>

        <Show when={!active()}>
          <Show when={help()}><p data-vesta="pack-job-help">{help()}</p></Show>
          <Show when={phase() !== 'interrupted' && phase() !== 'recovery'}><ServerErrorNote error={job().error} variant="inline" /></Show>
        </Show>

        <footer data-vesta="pack-job-actions">
          <Show when={active()} fallback={
            <>
              <Button variant="ghost" onClick={() => dismissInstallResult(area.id())}>{t('server-pack.job-dismiss')}</Button>
              <span data-vesta="pack-job-spacer" />
              <Show when={phase() === 'recovery'} fallback={
                <Show when={!adopted() || phase() === 'interrupted'}>
                  <Button tone="accent" icon={<Icon name="icons/actions/reload" />} disabled={!area.gates().installOnServer && !!job().request}
                    onClick={() => retryInstall(area.id())}>{t('server-pack.job-try-again')}</Button>
                </Show>
              }>
                <Button tone="accent" onClick={() => { dismissInstallResult(area.id()); transitionTo(`/servers/${area.id()}/settings/software`); }}>{t('server-pack.job-open-software')}</Button>
              </Show>
            </>
          }>
            <span data-vesta="pack-job-spacer" />
            <Show when={cancellablePhase(phase())}>
              <Button variant="outline" onClick={() => cancelInstall(area.id())}>{t('server-pack.job-cancel')}</Button>
            </Show>
          </Show>
        </footer>
      </section>
    </div>
  );
}

/** One line above other modpack sections while this server is installing. */
export function InstallJobBanner() {
  const area = useModpackArea();
  const phase = () => packJobPhase(area.id());
  return (
    <Show when={isActivePhase(phase())}>
      <div data-vesta="pack-job-banner" role="status">
        <Icon name="icons/content/modpack" size={14} />
        <span>{t('server-pack.job-banner')}</span>
        <span data-vesta="pack-job-banner-stage">{phase() ? t(phaseLabel(phase()!)) : ''}</span>
        <span data-vesta="pack-job-spacer" />
        <Button size="sm" variant="ghost" onClick={() => area.openServer()}>{t('server-pack.job-banner-open')}</Button>
      </div>
    </Show>
  );
}
