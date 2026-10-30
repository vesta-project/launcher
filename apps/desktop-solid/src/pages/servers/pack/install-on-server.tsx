import { Badge, Button, Dialog, Progress, SegmentedControl, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled, untrack } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { IntentMemo, lifecycleControls, newIntentId } from '../../../features/servers/model';
import {
  defaultInstallChoices, installCanProceedWithoutReview, installApplyRequest, installBlocker, installConflicts, installStagedCount, installWarning, linkReview, offerToPlayers,
  type ConflictChoice,
} from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import type { PackInstallOutcome, PackInstallPlan } from '../../../features/servers/native-pack';
import { useServerResource, invalidateServerResources } from '../../../features/servers/resources';
import { softwareResource, CONTENT_RESOURCES } from '../../../features/servers/server-resources';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { PackSoftwareChange } from './pack-software-change';
import type { SoftwareId } from '../../../features/servers/hosting-native';
import { useLifecycle } from '../lifecycle';
import { ServerErrorNote } from '../parts';
import { useModpackArea, type InstallRequestSource } from './area';

const conflictLabel: Record<NonNullable<PackInstallPlan['files'][number]['conflict']>, MessageId> = {
  project_version: 'server-pack.conflict-project-version',
  same_filename: 'server-pack.conflict-same-filename',
  unidentified_jar: 'server-pack.conflict-unidentified',
};

/**
 * Link the server to a modpack, or update the link: plan → review → apply. Server-side entries
 * are staged until the next restart; client-only entries are skipped. Linking never changes
 * what players get; afterwards the owner may also offer it to players (a separate choice).
 */
export function InstallOnServerDialog(props: { request: InstallRequestSource }) {
  const area = useModpackArea();
  const now = useServersClock();
  const [softwareOpen, setSoftwareOpen] = createSignal(false, { name: 'modpack-install:software-open' });
  const software = useServerResource(() => area.id(), softwareResource);
  const [installRequested, setInstallRequested] = createSignal(false, { name: 'modpack-install:requested' });
  const lifecycle = useLifecycle(area.snapshot);
  const [plan, setPlan] = createSignal<PackInstallPlan | null>(null, { name: 'modpack-install:plan' });
  const [picks, setPicks] = createSignal<Record<string, ConflictChoice>>({}, { name: 'modpack-install:picks' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-install:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-install:error' });
  const [outcome, setOutcome] = createSignal<PackInstallOutcome | null>(null, { name: 'modpack-install:outcome' });
  const intents = new IntentMemo();
  const [uncertain, setUncertain] = createSignal(false, { name: 'modpack-install:uncertain' });
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const planNow = async (): Promise<void> => {
    const startedRevision = untrack(() => software.value()?.revision);
    setBusy(true); setError(null); setPlan(null);
    try {
      const value = await serverCommand((api) => api.packInstallPlan(area.id(), { source: untrack(() => props.request.source) }));
      if (disposed) return;
      if (startedRevision !== undefined && startedRevision !== untrack(() => software.value()?.revision)) return planNow();
      setPlan(value);
      setPicks(defaultInstallChoices(value));
      if (untrack(installRequested) && installCanProceedWithoutReview(value, untrack(now))) await apply();
      else setInstallRequested(false);
    } catch (reason) { if (!disposed) setError(reason as ServerCommandError); }
    finally { if (!disposed) setBusy(false); }
  };
  // Plan once mounted: the first request writes state, which setup must not do.
  onSettled(() => { void software.refresh(); void planNow(); });
  let softwareRevision: string | undefined;
  createEffect(() => software.value()?.revision, revision => {
    const previous = softwareRevision; softwareRevision = revision;
    if (previous !== undefined && revision !== previous && !untrack(busy) && !untrack(outcome)) void planNow();
  }, { name: 'modpack-install:software-revision' });

  const blocker = () => { const value = plan(); return value ? installBlocker(value, now()) : null; };
  const request = createMemo(() => { const value = plan(); return value ? installApplyRequest(value, picks()) : null; }, { name: 'modpack-install:request' });
  const review = createMemo(() => { const value = plan(); return value ? linkReview(value) : null; }, { name: 'modpack-install:review' });
  const update = () => props.request.mode === 'update';
  const minutesLeft = () => { const value = plan(); return value ? Math.max(0, Math.ceil((value.expiresAtMs - now()) / 60_000)) : 0; };

  const apply = async () => {
    const body = request();
    if (!body || blocker()) return;
    setBusy(true); setError(null);
    try {
      const result = await serverCommand((api) => api.packInstallApply(area.id(), body, intents.idFor(body)));
      intents.settle();
      if (disposed) return;
      setOutcome(result);
      invalidateServerResources(area.id(), CONTENT_RESOURCES);
      void area.reload();
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setUncertain(intents.uncertain);
      if (!disposed) setError(reason as ServerCommandError);
    } finally { if (!disposed) setBusy(false); }
  };

  const close = () => {
    if (busy() && plan() && !outcome()) return;
    // An uploaded file the review read but nobody linked is cancelled rather than abandoned.
    const uploadId = untrack(() => props.request.uploadId);
    if (uploadId && !untrack(outcome)) void serverCommand((api) => api.packUploadCancel(area.id(), uploadId, newIntentId())).catch(() => {});
    area.startInstall(null);
  };
  const running = () => area.snapshot().status?.state === 'running';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }} closeLabel={t('nav.close')} size="lg"
      title={t(update() ? 'server-pack.update-dialog-title' : 'server-pack.link-dialog-title', { name: props.request.name || t('server-pack.untitled') })}
      description={t('server-pack.link-dialog-description', { title: area.snapshot().connection.name })}
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
          <Button variant="ghost" disabled={busy() && !!plan()} onClick={close}>{t('common.cancel')}</Button>
          <span data-vesta="server-toolbar-spacer" />
          <Show when={plan()}>
            <span data-vesta="server-muted">{t('server-pack.install-expires', { count: minutesLeft() })}</span>
          </Show>
          <Show when={!plan() && !error()}>
            <Button tone="accent" disabled={busy() || installRequested()} onClick={() => setInstallRequested(true)}>{t(busy() || installRequested() ? 'server-pack.install-preparing' : 'server-pack.install-action')}</Button>
          </Show>
          <Show when={plan()}>
            <Button tone="accent" disabled={busy() || !request() || !!blocker()} onClick={() => void apply()}>
              {uncertain() ? t('server-pack.retry') : t(update() ? 'server-pack.update-apply' : 'server-pack.link-apply', { count: installStagedCount(plan()!, picks()) })}
            </Button>
          </Show>
        </Show>
      }>
      <Show when={outcome()} fallback={
        <Show when={plan()} fallback={
          <div data-vesta="modpack-install-loading">
            <Show when={!error()}><Progress size="sm" label={t('server-pack.install-planning')} /></Show>
            <ServerErrorNote error={error()} onRetry={() => void planNow()} />
          </div>
        }>
          {(value) => (
            <div data-vesta="modpack-install">
              <div data-vesta="modpack-install-runtime">
                <span><small>{t('server-pack.install-software')}</small><strong>{value().software}</strong></span>
                <span><small>{t('server-pack.install-minecraft')}</small><strong>{value().minecraftVersion}</strong></span>
                <span><small>{t('server-pack.install-loader')}</small><strong>{value().loaderVersion ?? t('server-pack.install-none')}</strong></span>
                <Show when={value().softwareSwitchRequired} fallback={<Badge size="sm" tone="success" icon={<Icon name="icons/controls/check" size={11} />}>{t('server-pack.install-runtime-matches')}</Badge>}>
                  <Badge size="sm" tone="warning" icon={<Icon name="icons/controls/warning" size={11} />}>{t('server-pack.install-switch-badge')}</Badge>
                </Show>
              </div>
              <Show when={value().softwareSwitchRequired}>
                <div data-vesta="server-callout" data-tone="warning" role="alert">
                  <span>{t('server-pack.install-switch-help', { software: value().software, version: value().minecraftVersion })}</span>
                  <Show when={software.value()?.current}>{current => <span>{t('server-pack.install-current-runtime', { software: current().software ?? '', version: current().version ?? '', loader: current().loaderVersion ?? '' })}</span>}</Show>
                  <span data-vesta="modpack-inline-actions">
                    <Button size="sm" variant="outline" icon={<Icon name="icons/actions/external-link" />}
                      onClick={() => setSoftwareOpen(true)}>{t('server-pack.install-review-software')}</Button>
                    <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/refresh" />} disabled={busy()} onClick={() => void planNow()}>{t('server-pack.install-replan')}</Button>
                  </span>
                </div>
              </Show>
              <Show when={softwareOpen() && software.value()}>{state => <PackSoftwareChange id={area.id()} snapshot={area.snapshot()} state={state()}
                target={{ software: value().software as SoftwareId, version: value().minecraftVersion, loaderVersion: value().loaderVersion }}
                onWorking={setBusy} onComplete={() => { setSoftwareOpen(false); void planNow(); }} />}</Show>
              <Show when={!value().valid}><p data-vesta="server-callout" data-tone="danger" role="alert">{t('server-pack.install-invalid')}</p></Show>
              <Show when={blocker() === 'server-pack.install-expired'}>
                <div data-vesta="server-callout" data-tone="warning"><span>{t('server-pack.install-expired')}</span>
                  <Button size="sm" variant="outline" onClick={() => void planNow()}>{t('server-pack.install-replan')}</Button></div>
              </Show>
              <Show when={value().backupRecommended}>
                <div data-vesta="server-callout" data-tone="neutral">
                  <span><Icon name="icons/content/storage" size={14} /> {t('server-pack.install-backup')}</span>
                  <Button size="sm" variant="ghost" onClick={() => { area.startInstall(null); transitionTo(`/servers/${area.id()}/backups`); }}>{t('server-pack.install-open-backups')}</Button>
                </div>
              </Show>

              <Show when={installConflicts(value()).length}>
                <section data-vesta="modpack-install-section" data-tone="warning">
                  <h4>{t('server-pack.install-conflicts', { count: installConflicts(value()).length })}</h4>
                  <ul data-vesta="modpack-install-list">
                    <For each={installConflicts(value())}>
                      {(file) => (
                        <li data-vesta="modpack-conflict">
                          <span><code>{file.path}</code><small>{t(conflictLabel[file.conflict!])}</small></span>
                          <SegmentedControl size="sm" aria-label={t('server-pack.install-conflict-choice', { path: file.path })} value={picks()[file.path]}
                            onChange={(choice) => setPicks((current) => ({ ...current, [file.path]: choice as ConflictChoice }))}
                            options={[{ value: 'replace', label: t('server-pack.install-replace') }, { value: 'keep', label: t('server-pack.install-keep') }]} />
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </Show>

              <ReviewGroup title="server-pack.review-added" tone="success" icon="icons/actions/add" paths={review()!.added} />
              <ReviewGroup title="server-pack.review-updated" tone="accent" icon="icons/actions/refresh" paths={review()!.updated} />
              <ReviewGroup title="server-pack.review-removed" tone="danger" icon="icons/actions/delete" paths={review()!.removed} />
              <ReviewGroup title="server-pack.install-overrides" tone="neutral" icon="icons/content/file" paths={review()!.overrides} />
              <Show when={review()!.unchanged}>
                <p data-vesta="server-muted">{t('server-pack.review-unchanged', { count: review()!.unchanged })}</p>
              </Show>
              <Show when={review()!.removed.length}>
                <p data-vesta="server-muted">{t('server-pack.review-removed-help')}</p>
              </Show>
              <Show when={value().skipped.length}>
                <details data-vesta="modpack-unresolved">
                  <summary>{t('server-pack.install-skipped', { count: value().skipped.length })}</summary>
                  <ul><For each={value().skipped}>{(path) => <li><code>{path}</code></li>}</For></ul>
                </details>
              </Show>
              <Show when={value().warnings.length}>
                <details data-vesta="modpack-unresolved">
                  <summary>{t('server-pack.install-notes', { count: value().warnings.length })}</summary>
                  <ul data-vesta="modpack-warnings"><For each={value().warnings}>{(warning) => <li>{installWarning(warning, t)}</li>}</For></ul>
                </details>
              </Show>
              <p data-vesta="server-muted"><Icon name="icons/actions/reload" size={12} /> {t('server-pack.install-staged-help')}</p>
              <p data-vesta="server-muted"><Icon name="icons/content/modpack" size={12} /> {t('server-pack.link-players-unchanged')}</p>
              <Show when={uncertain()}><p data-vesta="server-callout" data-tone="warning">{t('server-pack.install-uncertain')}</p></Show>
              <ServerErrorNote error={error()} />
            </div>
          )}
        </Show>
      }>
        {(result) => (
          <div data-vesta="modpack-install-done" role="status">
            <span data-vesta="modpack-done-mark"><Icon name="icons/controls/check" size={20} /></span>
            <h4>{t('server-pack.install-staged', { count: result().pendingIds.length })}</h4>
            <p>{t(running() ? 'server-pack.install-staged-running' : 'server-pack.install-staged-stopped')}</p>
            <Show when={!update()}><OfferToPlayers /></Show>
          </div>
        )}
      </Show>
    </Dialog>
  );
}

function ReviewGroup(props: { title: MessageId; tone: 'success' | 'accent' | 'danger' | 'neutral'; icon: string; paths: string[] }) {
  return (
    <Show when={props.paths.length}>
      <details data-vesta="modpack-install-section" data-change={props.tone}>
        <summary>{t(props.title, { count: props.paths.length })}</summary>
        <ul data-vesta="modpack-install-list">
          <For each={props.paths}>{(path) => <li><Icon name={props.icon} size={12} /><code>{path}</code></li>}</For>
        </ul>
      </details>
    </Show>
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
