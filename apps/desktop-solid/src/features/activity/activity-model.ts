export type ActivityKind = 'task' | 'background';
export type ActivityState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface Activity {
  id: string;
  kind: ActivityKind;
  state: ActivityState;
  title: string;
  subtitle?: string;
  icon?: string;
  iconFallback?: string;
  progress?: number;
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

export function visibleTaskList(rows: readonly Activity[], now: number): Activity[] {
  return rows.filter((a) => a.kind === 'task' && !a.pillDismissed && (active(a)
    || (a.state === 'failed' && !a.seen)
    || (a.state === 'done' && now < (a.finishedAt ?? now) + SUCCESS_DURATION)));
}
export function backgroundList(rows: readonly Activity[], now: number): Activity[] {
  return rows.filter((a) => a.kind === 'background' && a.state === 'running' && now - a.startedAt >= BACKGROUND_DELAY);
}
/** Remaining-work weighted progress. An unknown task makes the aggregate indeterminate. */
export function weightedProgress(rows: readonly Activity[]): number | undefined {
  const running = rows.filter(active);
  if (!running.length || running.some((a) => a.progress === undefined)) return undefined;
  let weighted = 0;
  let weights = 0;
  for (const a of running) {
    const weight = a.weight !== undefined && Number.isFinite(a.weight) && a.weight > 0 ? a.weight : 1;
    weighted += a.progress! * weight;
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
    const restarting = old && terminal(old) && (patch.state === 'queued' || patch.state === 'running');
    const base = !old || restarting ? { kind: 'task' as const, state: 'queued' as const, title: '', startedAt: now, cancellable: false } : old;
    const next: Activity = { ...base, ...patch };
    if (next.progress !== undefined) next.progress = Number.isFinite(next.progress) ? Math.max(0, Math.min(1, next.progress)) : undefined;
    if (terminal(next)) {
      next.finishedAt ??= now;
      next.cancellable = false;
      if (next.state === 'done') next.progress = 1;
    } else if (next.state === 'running' && old?.state === 'queued') next.startedAt = now;
    this.rows = [next, ...this.rows.filter((a) => a.id !== next.id)];
    // Unseen failures are never evicted. Other terminal history is bounded.
    let finished = 0;
    this.rows = this.rows.filter((a) => !terminal(a) || (a.state === 'failed' && !a.seen) || ++finished <= 50);
  }
  dismiss(id: string) { this.rows = this.rows.map((a) => a.id === id ? { ...a, pillDismissed: true, seen: true } : a); }
  markSeen(ids?: readonly string[]) { this.rows = this.rows.map((a) => a.state === 'failed' && (!ids || ids.includes(a.id)) ? { ...a, seen: true } : a); }
  clearFinished(ids?: readonly string[]) { this.rows = this.rows.filter((row) => active(row) || (!!ids && !ids.includes(row.id))); }
}
