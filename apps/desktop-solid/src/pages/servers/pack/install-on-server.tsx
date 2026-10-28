import { Badge, Button, Checkbox, Dialog, Progress, SegmentedControl } from '@vesta/ui';
import { For, Show, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { IntentMemo, lifecycleControls } from '../../../features/servers/model';
import {
  defaultInstallChoices, installApplyRequest, installBlocker, installConflicts, installGroups, installStagedCount, installWarning,
  type ConflictChoice,
} from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import type { PackInstallOutcome, PackInstallPlan } from '../../../features/servers/native-pack';
import { invalidateServerResources } from '../../../features/servers/resources';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { useLifecycle } from '../lifecycle';
import { ServerErrorNote } from '../parts';
import { useModpackArea, type InstallRequestSource } from './area';

const conflictLabel: Record<NonNullable<PackInstallPlan['files'][number]['conflict']>, MessageId> = {
  project_version: 'server-pack.conflict-project-version',
  same_filename: 'server-pack.conflict-same-filename',
  unidentified_jar: 'server-pack.conflict-unidentified',
};

/**
 * Install a modpack on the server: plan → review → apply. Files are staged until the next restart;
 * using it as the server's modpack is a separate second step the agent reports on its own.
 */
export function InstallOnServerDialog(props: { request: InstallRequestSource }) {
  const area = useModpackArea();
  const now = useServersClock();
  const lifecycle = useLifecycle(area.snapshot);
  const [plan, setPlan] = createSignal<PackInstallPlan | null>(null, { name: 'modpack-install:plan' });
  const [picks, setPicks] = createSignal<Record<string, ConflictChoice>>({}, { name: 'modpack-install:picks' });
  const [setAsModpack, setSetAsModpack] = createSignal(untrack(() => props.request.setAsModpack), { name: 'modpack-install:assign' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-install:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-install:error' });
  const [outcome, setOutcome] = createSignal<PackInstallOutcome | null>(null, { name: 'modpack-install:outcome' });
  const intents = new IntentMemo();
  const [uncertain, setUncertain] = createSignal(false, { name: 'modpack-install:uncertain' });
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const planNow = async () => {
    setBusy(true); setError(null); setPlan(null);
    try {
      const value = await serverCommand((api) => api.packInstallPlan(area.id(), { source: untrack(() => props.request.source) }));
      if (disposed) return;
      setPlan(value);
      setPicks(defaultInstallChoices(value));
    } catch (reason) { if (!disposed) setError(reason as ServerCommandError); }
    finally { if (!disposed) setBusy(false); }
  };
  void planNow();

  const blocker = () => { const value = plan(); return value ? installBlocker(value, now()) : null; };
  const request = createMemo(() => { const value = plan(); return value ? installApplyRequest(value, picks(), setAsModpack()) : null; }, { name: 'modpack-install:request' });
  const groups = () => installGroups(plan()!);
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
      invalidateServerResources(area.id());
      if (result.modpackRevision !== null) void area.reload();
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setUncertain(intents.uncertain);
      if (!disposed) setError(reason as ServerCommandError);
    } finally { if (!disposed) setBusy(false); }
  };

  const close = () => {
    if (busy() && !outcome()) return;
    // An archive the review read but nobody installed or imported stays the caller's to cancel.
    area.startInstall(null);
  };
  const running = () => area.snapshot().status?.state === 'running';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }} closeLabel={t('nav.close')} size="lg"
      title={t('server-pack.install-dialog-title', { name: props.request.name || t('server-pack.untitled') })}
      description={t('server-pack.install-dialog-description', { title: area.snapshot().connection.name })}
      footer={
        <Show when={!outcome()} fallback={
          <>
            <Button variant="ghost" onClick={() => { area.startInstall(null); transitionTo(`/servers/${area.id()}/resources`); }}>{t('server-pack.install-open-content')}</Button>
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
          <Button tone="accent" disabled={busy() || !request() || !!blocker()} onClick={() => void apply()}>
            {uncertain() ? t('server-pack.retry') : t('server-pack.install-apply', { count: plan() ? installStagedCount(plan()!, picks()) : 0 })}
          </Button>
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
                  <span data-vesta="modpack-inline-actions">
                    <Button size="sm" variant="outline" icon={<Icon name="icons/actions/external-link" />}
                      onClick={() => { area.startInstall(null); transitionTo(`/servers/${area.id()}/settings/software`); }}>{t('server-pack.install-review-software')}</Button>
                    <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/refresh" />} disabled={busy()} onClick={() => void planNow()}>{t('server-pack.install-replan')}</Button>
                  </span>
                </div>
              </Show>
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

              <section data-vesta="modpack-install-section">
                <h4>{t('server-pack.install-content', { count: groups().content.length })}</h4>
                <ul data-vesta="modpack-install-list">
                  <For each={groups().content}>{(path) => <li><Icon name="icons/content/cube" size={12} /><code>{path}</code></li>}</For>
                </ul>
              </section>
              <Show when={groups().overrides.length}>
                <section data-vesta="modpack-install-section">
                  <h4>{t('server-pack.install-overrides', { count: groups().overrides.length })}</h4>
                  <ul data-vesta="modpack-install-list">
                    <For each={groups().overrides}>{(path) => <li><Icon name="icons/content/file" size={12} /><code>{path}</code></li>}</For>
                  </ul>
                </section>
              </Show>
              <Show when={value().skipped.length}>
                <details data-vesta="modpack-unresolved">
                  <summary>{t('server-pack.install-skipped', { count: value().skipped.length })}</summary>
                  <ul><For each={value().skipped}>{(path) => <li><code>{path}</code></li>}</For></ul>
                </details>
              </Show>
              <Show when={value().warnings.length}>
                <ul data-vesta="modpack-warnings">
                  <For each={value().warnings}>{(warning) => <li><Icon name="icons/controls/warning" size={12} />{installWarning(warning, t)}</li>}</For>
                </ul>
              </Show>
              <Checkbox size="sm" checked={setAsModpack()} onChange={setSetAsModpack} disabled={busy()}
                label={t('server-pack.install-assign', { title: area.snapshot().connection.name })} description={t('server-pack.install-assign-help')} />
              <p data-vesta="server-muted"><Icon name="icons/actions/reload" size={12} /> {t('server-pack.install-staged-help')}</p>
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
            <Show when={result().modpackRevision}>
              {(revision) => <p data-vesta="server-muted">{t('server-pack.install-assigned', { version: revision() })}</p>}
            </Show>
            <Show when={setAsModpack() && result().modpackRevision === null}>
              <p data-vesta="server-callout" data-tone="warning">{t('server-pack.install-assign-pending')}</p>
            </Show>
          </div>
        )}
      </Show>
    </Dialog>
  );
}
