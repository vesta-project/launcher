import '../../../components/metadata.css';
import { Badge, Button, Checkbox, Dialog, toast } from '@vesta/ui';
import type { Tone } from '@vesta/ui';
import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { errorMessage } from '../../../features/servers/errors';
import { age, newIntentId } from '../../../features/servers/model';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { invalidateServerResources, useServerResource } from '../../../features/servers/resources';
import { createBackupJobFollower } from '../../../features/servers/backup-jobs';
import { backupSnapshotsResource, backupStorageResource, backupsResource } from '../../../features/servers/server-resources';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { BackupJob, BackupSnapshot } from '../../../features/servers/native-manage';
import { ServerErrorNote } from '../parts';
import { backupsConfigured } from '../../../features/servers/shell-model';
import { BackupProfilesEditor, BackupSetup, BackupsEnabled, retentionText as retention } from './backup-profiles';
import '../../library/instance/settings-tab.css';

const bytes = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1000 && unit < units.length - 1) { amount /= 1000; unit++; }
  return `${amount >= 100 || unit === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unit]}`;
};

const jobTone = (job: BackupJob): Tone =>
  job.state === 'succeeded' ? 'success' : job.state === 'failed' || job.state === 'recovery_required' ? 'danger' : job.state === 'uncertain' ? 'warning' : 'accent';

const jobKind: Record<BackupJob['kind'], MessageId> = {
  backup: 'servers.backups.kind-backup',
  verify: 'servers.backups.kind-verify',
  restore: 'servers.backups.kind-restore-copy',
  restore_in_place: 'servers.backups.kind-restore',
};

const jobState: Record<BackupJob['state'], MessageId> = {
  awaiting_confirmation: 'servers.operation.awaiting-confirmation',
  queued: 'servers.operation.accepted',
  running: 'servers.operation.running',
  succeeded: 'servers.operation.succeeded',
  failed: 'servers.backups.failed',
  uncertain: 'servers.operation.checking',
  recovery_required: 'servers.operation.recovery-required',
};

const backupErrors: Record<string, MessageId> = {
  backup_requires_stopped_server: 'servers.backups.error-stopped',
  backup_disk_space_low: 'servers.backups.error-disk',
  backup_storage_limit_reached: 'servers.backups.error-storage',
  backup_snapshot_limit_reached: 'servers.backups.error-count',
  backup_confirmation_expired: 'servers.error.confirmation-expired',
};

export function BackupsTab(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const id = () => props.snapshot.connection.id;
  const connection = stableConnectionId(() => props.snapshot);
  // Shared with the workspace, which reads the overview to decide whether this tab exists.
  const backups = useServerResource(connection, backupsResource);
  const space = useServerResource(connection, backupStorageResource);
  const overview = () => backups.value() ?? null;
  const visibleJobs = () => (overview()?.jobs ?? []).filter(job => job.kind !== 'verify' || !!job.errorCode || job.state === 'failed' || job.state === 'recovery_required');
  const storage = () => space.value() ?? null;
  const error = backups.error;
  const loading = () => backups.loading() || backups.refreshing();
  const [openProfile, setOpenProfile] = createSignal<string | null>(null, { name: 'server-backups:open-profile' });
  const [restoring, setRestoring] = createSignal<{ profile: string; snapshot: BackupSnapshot } | null>(null, { name: 'server-backups:restoring' });
  const [started, setStarted] = createSignal<BackupJob | null>(null, { name: 'server-backups:started' });
  const can = (capability: string) => gate(props.snapshot.capabilities, capability) === 'allowed';
  const canConfigure = () => can('backups.configure');
  const configured = () => backupsConfigured(props.snapshot, overview());
  const settingUp = () => configured() === false && canConfigure();
  const [enabled, setEnabled] = createSignal<string | null>(null, { name: 'server-backups:just-enabled' });

  const profileActions = (name: string) => (
    <>
      <Button size="sm" variant="ghost" iconEnd={<Icon name="icons/controls/chevron-down" size={12} />} aria-expanded={openProfile() === name ? 'true' : 'false'}
        onClick={() => setOpenProfile(openProfile() === name ? null : name)}>
        {t('servers.backups.show-points')}
      </Button>
      <Show when={can('backups.create')}>
        <Button size="sm" tone="accent" icon={<Icon name="icons/actions/download" />} onClick={() => void start(name)}>{t('servers.backups.run')}</Button>
      </Show>
    </>
  );
  const profilePoints = (name: string) => (
    <Show when={openProfile() === name}>
      <BackupList snapshot={props.snapshot} profile={name} onRestore={(point) => setRestoring({ profile: name, snapshot: point })} onStarted={(job) => { setStarted(job); void refresh(); }} />
    </Show>
  );
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const refreshProjections = async () => {
    const requestedId = id();
    // Storage refresh retires the native read cache before snapshots are re-read.
    await space.refresh();
    if (!disposed && requestedId === id()) invalidateServerResources(requestedId, ['backup-snapshots']);
  };
  const refresh = async () => { await Promise.all([backups.refresh(), refreshProjections()]); };
  // Scope polling to the connection as well as the pane's lifetime. The jobs effect is a
  // sibling, not nested: Solid 2 halts all reactivity if an effect callback creates one.
  let follower: ReturnType<typeof createBackupJobFollower> | undefined;
  createEffect(connection, () => {
    const current = createBackupJobFollower({
      read: async () => { await backups.refresh(); return overview()?.jobs ?? []; },
      onTerminal: refreshProjections,
    });
    follower = current;
    return () => { current.dispose(); if (follower === current) follower = undefined; };
  }, { name: 'server-backups:follow' });
  // Tracks the connection too, so a new follower sees the jobs already shown.
  createEffect(() => ({ connection: connection(), jobs: overview()?.jobs ?? [], started: started() }), ({ jobs, started }) => {
    if (started) follower?.observe([started]);
    follower?.observe(jobs);
  }, { name: 'server-backups:jobs' });

  const start = async (profile: string) => {
    try {
      const job = await serverCommand((client) => client.backupRun(id(), profile, newIntentId()));
      if (disposed) return;
      setStarted(job);
      toast.show({ title: t('servers.backups.started', { name: profile }), tone: 'neutral' });
      void refresh();
    } catch (reason) {
      toast.show({ title: t(errorMessage(reason)), tone: 'danger' });
    }
  };

  const resolveRecovery = async () => {
    const job = overview()?.jobs.find((entry) => entry.state === 'recovery_required');
    if (!job) return;
    try { await serverCommand((client) => client.backupResolveRecovery(id(), job.id)); void refresh(); }
    catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
  };

  return (
    <div data-vesta="server-activity">
      <div data-vesta="pane-toolbar">
        <span data-vesta="server-toolbar-title">{t('servers.tab.backups')}</span>
        <span data-vesta="server-toolbar-spacer" />
        <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/refresh" />} disabled={loading()} onClick={() => void refresh()}>{t('servers.refresh')}</Button>
      </div>
      <div data-vesta="instance-settings-scroll">
        <ServerErrorNote error={error()} onRetry={() => void refresh()} />
        <Show when={overview()?.recoveryRequired}>
          <div data-vesta="server-callout" data-tone="danger" role="alert">
            <p>{t('servers.backups.recovery')}</p>
            <Show when={can('backups.restore')}>
              <Button size="sm" tone="danger" variant="outline" onClick={() => void resolveRecovery()}>{t('servers.backups.resolve')}</Button>
            </Show>
          </div>
        </Show>

        <Show when={enabled()}>
          {(profile) => <BackupsEnabled snapshot={props.snapshot} profile={profile()} onDismiss={() => setEnabled(null)} onRun={() => { setEnabled(null); void start(profile()); }} />}
        </Show>
        <Show when={!settingUp()} fallback={<BackupSetup snapshot={props.snapshot} onEnabled={(profile) => { setEnabled(profile); void refresh(); }} />}>
        <div data-vesta="backups-layout">
        <div data-vesta="backups-main">
        <Show when={canConfigure()} fallback={
        <section data-vesta="settings-panel">
          <h3>{t('servers.backups.profiles')}</h3>
          <Show when={configured()}><p data-vesta="server-muted" class="server-panel-note">{t('servers.backup-setup.view-only')}</p></Show>
          <div data-vesta="settings-panel-body">
            <Show when={overview()?.profiles.length} fallback={<p data-vesta="server-muted" class="server-panel-note">{loading() ? t('servers.loading') : overview() ? t('servers.backups.no-profiles') : t('servers.backups.not-loaded')}</p>}>
              <For each={overview()?.profiles ?? []}>
                {(profile) => (
                  <div data-vesta="server-backup-profile">
                    <div data-vesta="setting-row">
                      <div data-vesta="setting-row-copy">
                        <span data-vesta="setting-row-label">
                          {profile.name}
                          <Badge size="sm" variant="soft" tone="neutral">{t(profile.mode === 'online' ? 'servers.backups.mode-online' : 'servers.backups.mode-stopped')}</Badge>
                        </span>
                        <span data-vesta="setting-row-description">{retention(profile)}</span>
                      </div>
                      <div data-vesta="setting-row-control">{profileActions(profile.name)}</div>
                    </div>
                    {profilePoints(profile.name)}
                  </div>
                )}
              </For>
            </Show>
          </div>
        </section>
        }>
          <BackupProfilesEditor snapshot={props.snapshot} actions={profileActions} details={profilePoints} />
        </Show>
        </div>
        <aside data-vesta="backups-side">
        <Show when={storage()}>
          {(space) => (
            <section data-vesta="settings-panel">
              <h3>{t('servers.backups.storage')}</h3>
              <div data-vesta="server-backup-storage">
                <div><strong>{bytes(space().repositoryBytes)}</strong><span>{t('servers.backups.used')}</span></div>
                <div><strong>{space().restorePoints}</strong><span>{t('servers.backups.restore-points')}</span></div>
                <div><strong>{bytes(space().freeBytes)}</strong><span>{t('servers.backups.free')}</span></div>
                <Show when={space().limits.maxRepositoryBytes}>
                  {(limit) => (
                    <div data-vesta="server-backup-meter" role="meter" aria-valuenow={space().repositoryBytes} aria-valuemax={limit()} aria-label={t('servers.backups.used')}>
                      <span style={{ 'inline-size': `${Math.min(100, (space().repositoryBytes / limit()) * 100)}%` }} />
                      <small>{t('servers.backups.of-limit', { value: bytes(limit()) })}</small>
                    </div>
                  )}
                </Show>
              </div>
              <Show when={space().stopped}>
                {(code) => <p data-vesta="server-callout" data-tone="warning">{t(backupErrors[code()] ?? 'servers.backups.failed')}</p>}
              </Show>
            </section>
          )}
        </Show>

        <section data-vesta="settings-panel">
          <h3>{t('servers.backups.recent')}</h3>
          <Show when={visibleJobs().length} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('servers.backups.no-jobs')}</p>}>
            <ul data-vesta="server-activity-list" class="server-panel-list">
              <For each={visibleJobs()} keyed={(job) => job.id}>
                {(job) => {
                  const when = () => age(job().createdAtMs, now());
                  return (
                    <li data-vesta="server-activity-row">
                      <span data-vesta="server-activity-avatar" data-automated aria-hidden="true">
                        <Icon name={job().kind === 'verify' ? 'icons/security/shield-check' : job().kind === 'backup' ? 'icons/content/storage' : 'icons/content/history'} size={14} />
                      </span>
                      <div data-vesta="server-activity-body">
                        <p data-vesta="server-activity-line">
                          <Show when={job().requestedBy}>{(who) => <strong>{who()} </strong>}</Show>
                          {t(jobKind[job().kind], { name: job().profile })}
                        </p>
                        <Show when={job().errorCode}>{(code) => <p data-vesta="server-activity-detail">{t(backupErrors[code()] ?? 'servers.backups.failed')}</p>}</Show>
                        <p data-vesta="server-activity-meta">
                          <span>{t('servers.ago', { time: t(when().message, { count: when().count }) })}</span>
                          <Show when={job().result?.dataAdded !== undefined}><span>{t('servers.backups.added', { value: bytes(job().result?.dataAdded) })}</span></Show>
                          <Show when={job().result?.filesChanged !== undefined}><span>{t('servers.backups.files-changed', { count: (job().result?.filesChanged ?? 0) + (job().result?.filesNew ?? 0) })}</span></Show>
                        </p>
                      </div>
                      <Badge size="sm" variant="soft" tone={jobTone(job())}>{t(jobState[job().state])}</Badge>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </section>
        </aside>
        </div>
        </Show>
      </div>
      <Show when={restoring()} keyed>
        {(target) => <RestoreDialog snapshot={props.snapshot} profile={target.profile} point={target.snapshot} onClose={() => setRestoring(null)} onDone={(job) => { setStarted(job); void refresh(); }} />}
      </Show>
    </div>
  );
}

function BackupList(props: { snapshot: ServerSnapshot; profile: string; onRestore: (point: BackupSnapshot) => void; onStarted: (job: BackupJob) => void }) {
  const id = () => props.snapshot.connection.id;
  const points = useServerResource(stableConnectionId(() => props.snapshot), backupSnapshotsResource, { args: () => props.profile });
  const canRestore = () => gate(props.snapshot.capabilities, 'backups.restore') === 'allowed';
  const copy = async (point: BackupSnapshot) => {
    try {
      const job = await serverCommand((client) => client.backupRestoreCopy(id(), props.profile, point.id, [], newIntentId()));
      toast.show({ title: t('servers.backups.copy-started'), tone: 'neutral' });
      props.onStarted(job);
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
  };
  return (
    <div data-vesta="settings-reveal">
      <ServerErrorNote error={points.error()} onRetry={() => void points.refresh()} />
      <Show when={points.value()} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('servers.loading')}</p>}>
        {(list) => (
          <Show when={list().length} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('servers.backups.no-points')}</p>}>
            <For each={list()}>
              {(point) => (
                <div data-vesta="setting-row">
                  <div data-vesta="setting-row-copy">
                    <span data-vesta="setting-row-label">{new Date(point.time).toLocaleString()}</span>
                    <span data-vesta="setting-row-description"><span data-vesta="metadata"><code>{point.id.slice(0, 12)}</code><Show when={point.safety}><span>{t('servers.backups.safety')}</span></Show></span></span>
                  </div>
                  <Show when={canRestore()}>
                    <div data-vesta="setting-row-control">
                      <Button size="sm" variant="ghost" onClick={() => void copy(point)}>{t('servers.backups.restore-copy')}</Button>
                      <Button size="sm" variant="outline" tone="danger" onClick={() => props.onRestore(point)}>{t('servers.backups.restore')}</Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        )}
      </Show>
    </div>
  );
}

/** In-place restore: the game must be stopped, a safety snapshot is on by default, and the server's confirmation expires. */
function RestoreDialog(props: { snapshot: ServerSnapshot; profile: string; point: BackupSnapshot; onClose: () => void; onDone: (job: BackupJob) => void }) {
  const now = useServersClock();
  const [safety, setSafety] = createSignal(true, { name: 'server-restore:safety' });
  const [prepared, setPrepared] = createSignal<{ jobId: string; expiresAtMs: number } | null>(null, { name: 'server-restore:prepared' });
  const [busy, setBusy] = createSignal(false, { name: 'server-restore:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-restore:error' });
  const id = () => props.snapshot.connection.id;
  const stopped = () => props.snapshot.status?.state === 'stopped';
  const prepare = async () => {
    setBusy(true); setError(null);
    try {
      const result = await serverCommand((client) => client.backupRestorePrepare(id(), props.profile, props.point.id, [], !safety(), newIntentId()));
      setPrepared({ jobId: result.job.id, expiresAtMs: result.expiresAtMs });
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    let current = prepared();
    if (!current) return;
    setBusy(true); setError(null);
    try {
      if (current.expiresAtMs <= now()) {
        const fresh = await serverCommand(client => client.backupRestorePrepare(id(), props.profile, props.point.id, [], !safety(), newIntentId()));
        current = { jobId: fresh.job.id, expiresAtMs: fresh.expiresAtMs };
        setPrepared(current);
      }
      const jobId = current.jobId;
      const job = await serverCommand((client) => client.backupRestoreConfirm(id(), jobId));
      toast.show({ title: t('servers.backups.restore-started'), tone: 'neutral' });
      props.onDone(job);
      props.onClose();
    } catch (reason) { setError(reason as ServerCommandError); setPrepared(null); }
    finally { setBusy(false); }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      title={t('servers.backups.restore-title')}
      description={t('servers.backups.restore-description', { time: new Date(props.point.time).toLocaleString() })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button>
          <Show
            when={prepared()}
            fallback={<Button tone="danger" variant="outline" disabled={busy() || !stopped()} onClick={() => void prepare()}>{t('servers.backups.prepare')}</Button>}
          >
            <Button tone="danger" disabled={busy() || !stopped()} onClick={() => void confirm()}>{t('servers.backups.confirm-restore')}</Button>
          </Show>
        </>
      }
    >
      <Show when={!stopped()}>
        <p data-vesta="server-callout" data-tone="warning">{t('servers.backups.stop-first')}</p>
      </Show>
      <Checkbox checked={safety()} onChange={setSafety} disabled={!!prepared()} label={t('servers.backups.safety-first')} />
      <Show when={!safety()}>
        <p data-vesta="server-callout" data-tone="danger">{t('servers.backups.no-safety-warning')}</p>
      </Show>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}
