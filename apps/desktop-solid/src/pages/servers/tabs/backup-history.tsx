import { Badge, Button, IconButton, TextField, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { LIVE, cleanLabel, graphRows, labelProblem, laneCount, liveIsBranch, withLineage, type BackupHistory as BackupHistoryData, type BackupPoint, type GraphRow } from '../../../features/servers/backup-graph-model';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import { age, newIntentId } from '../../../features/servers/model';
import type { ServerSnapshot } from '../../../features/servers/native';
import type { BackupJob } from '../../../features/servers/native-manage';
import { seedServerResource, useServerResource } from '../../../features/servers/resources';
import { backupHistoryResource } from '../../../features/servers/server-resources';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import './backup-history.css';

const LANE = 16;
const NODE_Y = 18;
const x = (lane: number) => 10 + lane * LANE;

/**
 * Backups as branches, like git: every backup sits on the line of the world it was taken from.
 * Continuing from an older backup grows a new branch, and the world it left stays as one, so any
 * point can be picked up again. The live world is the top row, and its ancestry is accented.
 */
export function BackupHistory(props: { snapshot: ServerSnapshot; onRestore: (point: BackupPoint) => void; onStarted: (job: BackupJob) => void }) {
  const connection = stableConnectionId(() => props.snapshot);
  const history = useServerResource(connection, backupHistoryResource);
  const rows = createMemo(() => (history.value() ? graphRows(history.value()!) : []), { name: 'backup-history:rows' });
  const lanes = () => laneCount(rows());
  const flat = () => { const value = history.value(); return !!value && value.head === null && value.points.every((point) => point.parentId === null) && value.points.length > 1; };
  return (
    <section data-vesta="settings-panel" data-panel="backup-history">
      <h3>{t('servers.backups.history')}</h3>
      <ServerErrorNote error={history.error()} onRetry={() => void history.refresh()} />
      <Show when={flat()}><p data-vesta="server-muted" class="server-panel-note">{t('servers.backups.history-flat')}</p></Show>
      <Show when={history.value()} fallback={<Show when={!history.error()}><p data-vesta="server-muted" class="server-panel-note">{t('servers.loading')}</p></Show>}>
        <Show when={history.value()!.points.length} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('servers.backups.no-points')}</p>}>
          <ol data-vesta="backup-graph" style={{ '--graph-width': `${lanes() * LANE + 4}px` }}>
            <For each={rows()} keyed={(row) => row.id}>
              {(row) => <Row snapshot={props.snapshot} row={row()} history={history.value()!} onUpdated={(next) => seedServerResource(connection(), backupHistoryResource, next)} onRestore={props.onRestore} onStarted={props.onStarted} />}
            </For>
          </ol>
        </Show>
      </Show>
    </section>
  );
}

/** One row's slice of the graph: lines passing by, the line in from above, branches joining, the line down. */
function Lines(props: { row: GraphRow }) {
  return (
    <span data-vesta="backup-graph-cell" aria-hidden="true"><svg data-vesta="backup-graph-lines">
      <For each={props.row.through}>{(line) => <line x1={x(line.lane)} x2={x(line.lane)} y1="0" y2="100%" data-live={line.live ? '' : undefined} />}</For>
      <Show when={props.row.above}>{(line) => <line x1={x(line().lane)} x2={x(line().lane)} y1="0" y2={NODE_Y} data-live={line().live ? '' : undefined} />}</Show>
      <For each={props.row.joins}>{(line) => <path d={`M ${x(line.lane)} 0 Q ${x(line.lane)} ${NODE_Y} ${x(props.row.lane)} ${NODE_Y}`} data-live={line.live ? '' : undefined} />}</For>
      <Show when={props.row.below}>{(line) => <line x1={x(line().lane)} x2={x(line().lane)} y1={NODE_Y} y2="100%" data-live={line().live ? '' : undefined} />}</Show>
      <circle cx={x(props.row.lane)} cy={NODE_Y} r={props.row.id === LIVE ? 6 : 5} data-live={props.row.live ? '' : undefined}
        data-kind={props.row.id === LIVE ? 'live' : props.row.point?.safety ? 'safety' : 'point'} />
    </svg></span>
  );
}

function Row(props: { snapshot: ServerSnapshot; row: GraphRow; history: BackupHistoryData; onUpdated: (next: BackupHistoryData) => void; onRestore: (point: BackupPoint) => void; onStarted: (job: BackupJob) => void }) {
  const now = useServersClock();
  const connection = stableConnectionId(() => props.snapshot);
  const canRestore = () => gate(props.snapshot.capabilities, 'backups.restore') === 'allowed';
  const [naming, setNaming] = createSignal<string | null>(null, { name: 'backup-row:naming' });
  const [busy, setBusy] = createSignal(false, { name: 'backup-row:busy' });
  const when = (time: string) => { const ago = age(Date.parse(time), now()); return t('servers.ago', { time: t(ago.message, { count: ago.count }) }); };
  const head = () => { const value = props.history; return value ? withLineage(value).points.find((point) => point.id === withLineage(value).head) ?? null : null; };
  /** Where the live world stands: on the newest backup of its branch, or just continued from an older one. */
  const liveText = () => {
    const point = head();
    if (!point) return t('servers.backups.live-none');
    return liveIsBranch(props.history)
      ? t('servers.backups.live-branch', { name: point.label ?? when(point.time) })
      : point.label ? t('servers.backups.live-tip-named', { name: point.label }) : t('servers.backups.live-tip', { time: when(point.time) });
  };

  const update = async (point: BackupPoint, request: { label?: string | null; kept?: boolean }) => {
    setBusy(true);
    try {
      const next = await serverCommand((client) => client.backupPointUpdate(connection(), point.id, request, newIntentId()));
      const current = props.history;
      props.onUpdated({ ...current, points: current.points.map((entry) => (entry.id === next.id ? next : entry)) });
      setNaming(null);
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
    finally { setBusy(false); }
  };
  const copy = async (point: BackupPoint) => {
    try {
      const job = await serverCommand((client) => client.backupRestoreCopy(connection(), point.profile ?? '', point.id, [], newIntentId()));
      toast.show({ title: t('servers.backups.copy-started'), tone: 'neutral' });
      props.onStarted(job);
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
  };

  return (
    <li data-vesta="backup-commit" data-live={props.row.live ? '' : undefined} data-kind={props.row.id === LIVE ? 'live' : 'point'}>
      <Lines row={props.row} />
      <Show when={props.row.point} fallback={
        <div data-vesta="backup-commit-body">
          <p data-vesta="backup-commit-title"><strong>{t('servers.backups.live')}</strong></p>
          <p data-vesta="backup-commit-meta">
            {liveText()}
          </p>
        </div>
      }>
        {(point) => (
          <>
            <div data-vesta="backup-commit-body">
              <Show when={naming() !== null} fallback={
                <p data-vesta="backup-commit-title">
                  <strong data-tip={new Date(point().time).toLocaleString()}>{point().label ?? when(point().time)}</strong>
                  <Show when={point().profile}>{(profile) => <Badge size="sm" variant="soft" tone="neutral">{profile()}</Badge>}</Show>
                  <Show when={point().safety}><Badge size="sm" variant="soft" tone="warning">{t('servers.backups.safety')}</Badge></Show>
                  <Show when={point().kept}><span data-vesta="backup-commit-kept" data-tip={t('servers.backups.keep-help')}><Icon name="icons/actions/pin" size={12} />{t('servers.backups.kept')}</span></Show>
                </p>
              }>
                <form data-vesta="backup-commit-rename" onSubmit={(event) => { event.preventDefault(); if (!labelProblem(naming()!)) void update(point(), { label: cleanLabel(naming()!) }); }}>
                  <TextField size="sm" aria-label={t('servers.backups.rename')} placeholder={t('servers.backups.label-placeholder')} value={naming()!} onChange={setNaming}
                    error={labelProblem(naming()!) ? t(labelProblem(naming()!)!) : undefined} disabled={busy()} />
                  <Button size="sm" type="submit" tone="accent" disabled={busy() || !!labelProblem(naming()!)}>{t('servers.backups.save-label')}</Button>
                  <Button size="sm" variant="ghost" disabled={busy()} onClick={() => setNaming(null)}>{t('common.cancel')}</Button>
                </form>
              </Show>
              <p data-vesta="backup-commit-meta">
                <span>{new Date(point().time).toLocaleString()}</span>
                <Show when={point().label}><span>{when(point().time)}</span></Show>
                <code>{point().id.slice(0, 8)}</code>
              </p>
            </div>
            <Show when={canRestore() && naming() === null}>
              <div data-vesta="backup-commit-actions">
                <IconButton size="sm" variant="ghost" label={t('servers.backups.rename')} icon={<Icon name="icons/actions/edit" size={14} />} disabled={busy()} onClick={() => setNaming(point().label ?? '')} />
                <IconButton size="sm" variant="ghost" label={t(point().kept ? 'servers.backups.unkeep' : 'servers.backups.keep')} aria-pressed={point().kept ? "true" : "false"}
                  icon={<Icon name="icons/actions/pin" size={14} />} disabled={busy()} onClick={() => void update(point(), { kept: !point().kept })} />
                <Button size="sm" variant="ghost" onClick={() => void copy(point())}>{t('servers.backups.restore-copy')}</Button>
                <Show when={!(props.row.live && point().id === head()?.id && !liveIsBranch(props.history))}>
                  <Button size="sm" variant="outline" icon={<Icon name="icons/content/history" size={14} />} onClick={() => props.onRestore(point())}>{t('servers.backups.restore')}</Button>
                </Show>
              </div>
            </Show>
          </>
        )}
      </Show>
    </li>
  );
}
