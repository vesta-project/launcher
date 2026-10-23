import type { BackupJob } from './native-manage';

export const backupJobTerminal = (job: Pick<BackupJob, 'state'>) =>
  ['succeeded', 'failed', 'uncertain', 'recovery_required'].includes(job.state);

/** One bounded poll loop for all jobs owned by a mounted backups pane. */
export function createBackupJobFollower(options: {
  read: () => Promise<readonly BackupJob[]>;
  onTerminal: () => Promise<void>;
  intervalMs?: number;
  maxPolls?: number;
}) {
  const pending = new Map<string, number>();
  const finished = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let disposed = false;
  const schedule = () => {
    if (!pending.size) { clearTimeout(timer); timer = undefined; return; }
    if (disposed || busy || timer || !pending.size) return;
    timer = setTimeout(() => void poll(), options.intervalMs ?? 3000);
  };
  const observe = (jobs: readonly BackupJob[]) => {
    if (disposed) return;
    let terminal = false;
    for (const job of jobs) {
      if (backupJobTerminal(job)) {
        if (pending.delete(job.id)) terminal = true;
        finished.add(job.id);
      } else if (job.state !== 'awaiting_confirmation' && !pending.has(job.id) && !finished.has(job.id)) {
        pending.set(job.id, 0);
      }
    }
    while (finished.size > 256) finished.delete(finished.values().next().value!);
    if (terminal) void options.onTerminal().catch(() => {});
    schedule();
  };
  const poll = async () => {
    timer = undefined;
    if (disposed) return;
    busy = true;
    try {
      const jobs = await options.read();
      if (!disposed) observe(jobs);
    } catch { /* Cached reads retain their error and own transport backoff. */ }
    finally {
      busy = false;
      if (!disposed) {
        for (const [id, count] of pending) {
          if (count + 1 >= (options.maxPolls ?? 1200)) { pending.delete(id); finished.add(id); }
          else pending.set(id, count + 1);
        }
        // Retained overview pages are bounded; don't retain a session's entire job history.
        while (finished.size > 256) finished.delete(finished.values().next().value!);
        schedule();
      }
    }
  };
  return {
    observe,
    dispose: () => { disposed = true; clearTimeout(timer); pending.clear(); finished.clear(); },
  };
}
