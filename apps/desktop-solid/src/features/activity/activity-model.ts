import type { ActivitySubject, ActivityCount } from './activity-text';
export type ActivityKind = 'task' | 'background' | 'instance_install' | 'modpack_install' | 'modpack_update' | 'modpack_export' | 'resource_install' | 'java_download' | 'launcher_import' | 'import_resync' | 'resource_enrichment' | 'manifest_refresh' | 'profile_sync' | 'instance_duplicate' | 'instance_reset' | 'instance_repair' | 'instance_delete' | 'world_transfer' | 'drop_apply';
export type ActivityState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface Activity {
  id: string;
  /** Native Task Manager attempt; retries may reuse a logical task ID. */
  attempt?: string;
  kind: ActivityKind;
  visibility?: 'foreground' | 'background';
  subject?: ActivitySubject | null;
  source?: ActivitySubject | null;
  destination?: ActivitySubject | null;
  mode?: 'copy' | 'move' | null;
  stage?: string;
  items?: ActivityCount | null;
  bytes?: ActivityCount | null;
  fileName?: string | null;
  state: ActivityState;
  title: string;
  subtitle?: string;
  icon?: string;
  iconFallback?: string;
  /** Current stage-local progress. */
  progress?: number;
  /** Explicit whole-operation estimate, when provided by the task. */
  overallProgress?: number;
  /** Estimated remaining units, comparable across tasks; unknown uses one unit. */
  weight?: number;
  step?: string;
  currentStep?: number;
  totalSteps?: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  cancellable: boolean;
  target?: { instanceId?: string; route?: string };
  action?: 'play' | 'open';
  seen?: boolean;
  pillDismissed?: boolean;
}
export type ActivityPatch = Partial<Activity> & Pick<Activity, 'id'>;
export type PillState =
  | { state: 'idle' }
  | { state: 'quiet'; activities: readonly Activity[] }
  | { state: 'running'; activities: readonly Activity[]; count: number; icons: readonly Activity[]; extraCount: number; progress?: number }
  | { state: 'success' | 'failed'; activity: Activity };
export const BACKGROUND_DELAY = 1500;
export const SUCCESS_DURATION = 6000;
export const active = (activity: Activity) => activity.state === 'running' || activity.state === 'queued';
export const terminal = (activity: Activity) => !active(activity);

export const isForeground = (activity: Activity) => activity.visibility ? activity.visibility === 'foreground' : activity.kind !== 'background';

export function visibleTaskList(rows: readonly Activity[], now: number): Activity[] {
  return rows.filter((a) => isForeground(a) && !a.pillDismissed && (active(a)
    || (a.state === 'failed' && !a.seen)
    || (a.state === 'done' && now < (a.finishedAt ?? now) + SUCCESS_DURATION)));
}
export function backgroundList(rows: readonly Activity[], now: number): Activity[] {
  return rows.filter((a) => !isForeground(a) && a.state === 'running' && now - a.startedAt >= BACKGROUND_DELAY);
}
export const activityProgress = (activity: Activity) => activity.overallProgress ?? activity.progress;

/** Remaining-work weighted progress. An unknown task makes the aggregate indeterminate. */
export function weightedProgress(rows: readonly Activity[]): number | undefined {
  const running = rows.filter(active);
  if (!running.length || running.some((a) => activityProgress(a) === undefined)) return undefined;
  let weighted = 0;
  let weights = 0;
  for (const a of running) {
    const weight = a.weight !== undefined && Number.isFinite(a.weight) && a.weight > 0 ? a.weight : 1;
    weighted += activityProgress(a)! * weight;
    weights += weight;
  }
  return weighted / weights;
}
export function selectPill(rows: readonly Activity[], now: number): PillState {
  const visible = visibleTaskList(rows, now);
  const running = visible.filter(active);
  if (running.length) return { state: 'running', activities: running, count: running.length, icons: running.slice(0, 3), extraCount: Math.max(0, running.length - 3), progress: weightedProgress(running) };
  // Quiet failures also need attention, even if they failed before the delay.
  const failed = rows.find((a) => a.state === 'failed' && !a.seen && !a.pillDismissed);
  if (failed) return { state: 'failed', activity: failed };
  const done = visible.find((a) => a.state === 'done');
  if (done) return { state: 'success', activity: done };
  const background = backgroundList(rows, now);
  return background.length ? { state: 'quiet', activities: background } : { state: 'idle' };
}

/** Pure lifecycle model; the reactive adapter owns event batching and wake-up timers. */
export class ActivityLedger {
  rows: readonly Activity[] = [];
  upsert(patch: ActivityPatch, now: number) {
    const old = this.rows.find((a) => a.id === patch.id);
    const restarting = old && ((patch.attempt !== undefined && patch.attempt !== old.attempt)
      || (terminal(old) && (patch.state === 'queued' || patch.state === 'running')));
    const base = !old || restarting ? { kind: 'task' as const, state: 'queued' as const, title: '', startedAt: now, cancellable: false } : old;
    const next: Activity = { ...base, ...patch };
    if (next.progress !== undefined) next.progress = Number.isFinite(next.progress) ? Math.max(0, Math.min(1, next.progress)) : undefined;
    if (next.overallProgress !== undefined) {
      next.overallProgress = Number.isFinite(next.overallProgress) ? Math.max(0, Math.min(1, next.overallProgress)) : undefined;
      if (!restarting && old?.overallProgress !== undefined && next.overallProgress !== undefined)
        next.overallProgress = Math.max(old.overallProgress, next.overallProgress);
    }
    if (terminal(next)) {
      next.finishedAt ??= now;
      next.cancellable = false;
      if (next.state === 'done') { next.progress = 1; if (next.overallProgress !== undefined) next.overallProgress = 1; }
    } else if (next.state === 'running' && old?.state === 'queued' && patch.startedAt === undefined) next.startedAt = now;
    this.rows = [next, ...this.rows.filter((a) => a.id !== next.id)];
    // Unseen failures are never evicted. Other terminal history is bounded.
    let finished = 0;
    this.rows = this.rows.filter((a) => !terminal(a) || (a.state === 'failed' && !a.seen) || ++finished <= 50);
  }
  retireActive(ids: readonly string[]) {
    const missing = new Set(ids);
    this.rows = this.rows.filter((row) => !missing.has(row.id) || terminal(row));
  }
  dismiss(id: string) { this.rows = this.rows.map((a) => a.id === id ? { ...a, pillDismissed: true, seen: true } : a); }
  markSeen(ids?: readonly string[]) { this.rows = this.rows.map((a) => a.state === 'failed' && (!ids || ids.includes(a.id)) ? { ...a, seen: true } : a); }
  clearFinished(ids?: readonly string[]) { this.rows = this.rows.filter((row) => active(row) || (!!ids && !ids.includes(row.id))); }
}
