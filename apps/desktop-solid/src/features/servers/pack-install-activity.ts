// Server modpack installs in the activity panel, so an install is visible (and cancellable while
// it still can be) from every page. Presentation only: the job store owns the install itself.
import { untrack } from 'solid-js';
import { receiveActivity, registerActivityCancel, type ActivityPatch } from '../activity/activity-store';
import { t } from '../../localization';
import { serverModpackPath } from './modpack-area-model';
import type { ConnectionId } from './native';
import { cancellablePhase, formatBytes, isActivePhase, phaseLabel, progressView, type PackJobPhase } from './pack-install-job';
import { cancelInstall, onPackInstallChange, type PackInstallJobState, type PackInstallNote } from './pack-install-store';
import { serverSnapshot } from './store';

export const ACTIVITY_PREFIX = 'server-pack:';
const activityIds = new Map<ConnectionId, string>();

function names(id: ConnectionId, state: PackInstallJobState) {
  const name = state.request?.name || t('server-pack.untitled');
  const server = untrack(() => serverSnapshot(id))?.connection.name ?? '';
  return { name, server };
}

function finish(id: ConnectionId, state: PackInstallJobState, phase: PackJobPhase | null, outcome: 'done' | 'failed' | 'cancelled', note?: PackInstallNote) {
  const activityId = activityIds.get(id);
  if (!activityId) return;
  activityIds.delete(id);
  receiveActivity({
    id: activityId, state: outcome, finishedAt: Date.now(), cancellable: false, progress: outcome === 'done' ? 1 : undefined,
    doneTitle: t('server-pack.job-activity-done', names(id, state)),
    ...(outcome === 'failed' ? { error: t(phaseLabel(phase ?? 'failed')) } : {}),
    ...(note === 'cancelled-backup-continues' ? { subtitle: t('server-pack.job-cancel-backup-continues') } : {}),
  });
}

function update(id: ConnectionId, state: PackInstallJobState, phase: PackJobPhase | null, note?: PackInstallNote) {
  if (note) { finish(id, state, phase, 'cancelled', note); return; }
  if (!isActivePhase(phase)) {
    if (phase) finish(id, state, phase, phase === 'succeeded' ? 'done' : 'failed');
    return;
  }
  let activityId = activityIds.get(id);
  if (!activityId) { activityId = `${ACTIVITY_PREFIX}${id}:${state.startedAt ?? Date.now()}`; activityIds.set(id, activityId); }
  const view = progressView(phase, state.progress);
  const row: ActivityPatch = {
    id: activityId, kind: 'modpack_install', state: 'running', startedAt: state.startedAt ?? Date.now(),
    title: t('server-pack.job-activity-title', names(id, state)),
    stageLabel: t(view.stage),
    counter: view.items ? `${view.items.completed} / ${view.items.total}` : view.bytes ? formatBytes(view.bytes) : undefined,
    // Activity rows use a 0-1 fraction (native rows are normalized the same way).
    progress: view.percent === undefined ? undefined : view.percent / 100,
    cancellable: cancellablePhase(phase),
    target: { route: serverModpackPath(id) },
    action: 'open',
  };
  receiveActivity(row, true);
}

let installed = false;
/** Idempotent; loaded by the install UI so every place an install can start is covered. */
export function installPackActivity() {
  if (installed) return;
  installed = true;
  onPackInstallChange(update);
  registerActivityCancel(ACTIVITY_PREFIX, (activityId) => {
    for (const [id, current] of activityIds) if (current === activityId) cancelInstall(id);
  });
}
