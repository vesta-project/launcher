import { createMemo, createRoot, createSignal } from 'solid-js';
import { ActivityLedger, active, BACKGROUND_DELAY, SUCCESS_DURATION, backgroundList, selectPill, visibleTaskList, weightedProgress, type Activity, type ActivityPatch, type PillState } from './activity-model';
export type { Activity, ActivityKind, ActivityState, ActivityPatch, PillState } from './activity-model';

const ledger = new ActivityLedger();
const [activities, setActivities] = createSignal<readonly Activity[]>([], { name: 'activities' });
const [clock, setClock] = createSignal(Date.now(), { name: 'activityClock' });
const [activityError, setActivityError] = createSignal<string | undefined>(undefined, { name: 'activityError' });
export { activities, activityError };
let wake: ReturnType<typeof setTimeout> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, ActivityPatch>();
let cancel: (id: string) => Promise<unknown> = async () => {};

function samePill(a: PillState, b: PillState): boolean {
  if (a.state === 'idle' && b.state === 'idle') return true;
  if (a.state === 'quiet' && b.state === 'quiet') return sameRows(a.activities, b.activities);
  if (a.state === 'running' && b.state === 'running') return a.progress === b.progress && sameRows(a.activities, b.activities);
  if ((a.state === 'success' || a.state === 'failed') && a.state === b.state && 'activity' in b) return a.activity === b.activity;
  return false;
}
const sameRows = (a: readonly Activity[], b: readonly Activity[]) => a.length === b.length && a.every((row, i) => row === b[i]);
export const { visibleTasks, backgroundActivities, overallProgress, pillState } = createRoot(() => {
  const visibleTasks = createMemo(() => visibleTaskList(activities(), clock()), { name: 'visibleActivities', equals: sameRows });
  const backgroundActivities = createMemo(() => backgroundList(activities(), clock()), { name: 'backgroundActivities', equals: sameRows });
  const overallProgress = createMemo(() => weightedProgress(activities().filter((a) => a.kind === 'task' && !a.pillDismissed)), { name: 'overallActivityProgress' });
  const pillState = createMemo<PillState>(() => selectPill(activities(), clock()), { name: 'activityPill', equals: samePill });
  return { visibleTasks, backgroundActivities, overallProgress, pillState };
});
function publish() {
  const now = Date.now();
  setActivities(ledger.rows);
  setClock(now);
  clearTimeout(wake);
  const deadlines = ledger.rows.flatMap((a) => a.kind === 'background' && a.state === 'running' ? [a.startedAt + BACKGROUND_DELAY]
    : a.kind === 'task' && a.state === 'done' && !a.pillDismissed ? [(a.finishedAt ?? now) + SUCCESS_DURATION] : []).filter((at) => at > now);
  if (deadlines.length) wake = setTimeout(publish, Math.min(...deadlines) - now);
}
export function flushActivityProgress() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!pending.size) return;
  for (const patch of pending.values()) ledger.upsert(patch, Date.now());
  pending.clear();
  publish();
}
/** Lifecycle changes publish immediately; high-frequency deltas coalesce per task for 100ms. */
export function receiveActivity(patch: ActivityPatch, coalesce = false) {
  if (coalesce) {
    pending.set(patch.id, { ...pending.get(patch.id), ...patch });
    flushTimer ??= setTimeout(flushActivityProgress, 100);
    return;
  }
  const delta = pending.get(patch.id);
  pending.delete(patch.id);
  ledger.upsert({ ...delta, ...patch }, Date.now());
  publish();
}
export function configureActivityCancellation(handler: typeof cancel) { cancel = handler; }
export async function cancelActivity(id: string) {
  const activity = ledger.rows.find((a) => a.id === id);
  if (!activity?.cancellable || !active(activity)) return;
  if (import.meta.env?.DEV && id.startsWith('fixture-')) {
    receiveActivity({ id, state: 'cancelled' });
    return;
  }
  try { await cancel(id); }
  catch (error) { setActivityError(String(error)); throw error; }
  // Host acknowledges cancellation through lifecycle events, not the command return.
}
/** Hides pill presence, retaining the panel row. */
export function dismissActivity(id: string) { flushActivityProgress(); ledger.dismiss(id); publish(); }
/** Authoritative native snapshots retire vanished running rows, preserving terminal history. */
export function retireHostActivities(ids: readonly string[]) {
  ids.forEach((id) => pending.delete(id));
  ledger.retireActive(ids);
  publish();
}
export function clearFinished() { flushActivityProgress(); ledger.clearFinished(); publish(); }
/** Used by the simulator to remove only its own terminal history. */
export function clearFinishedActivities(ids: readonly string[]) { flushActivityProgress(); ledger.clearFinished(ids); publish(); }
export function markSeen(ids?: readonly string[]) { flushActivityProgress(); ledger.markSeen(ids); publish(); }
/** Called only by the owning desktop connection on teardown. */
export function stopActivityTimers() { flushActivityProgress(); clearTimeout(wake); clearTimeout(flushTimer); }
export function reportActivityError(error: unknown) { setActivityError(String(error)); }

let backgroundSequence = 0;
/** Wrap work without host lifecycle events. Call inside a cache loader so cache hits stay silent.
 * The caller supplies a localized label; this helper never stores results or credentials.
 */
export async function runBackgroundActivity<T>(title: string, work: () => Promise<T>): Promise<T> {
  const id = `background-client-${++backgroundSequence}`;
  receiveActivity({ id, title, kind: 'background', state: 'running', cancellable: false });
  try {
    const result = await work();
    receiveActivity({ id, state: 'done' });
    return result;
  } catch (error) {
    receiveActivity({ id, state: 'failed', error: String(error) });
    throw error;
  }
}
