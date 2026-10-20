import { createSignal } from 'solid-js';
import { findLauncher } from '../installation/launchers';
import type { HostCandidate, ImportCandidate, ImportResult, LauncherSummary } from './model';

export interface ImportSource {
  importLauncherKind?: string | null;
  importInstancePath?: string | null;
}
export interface CandidateState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  candidates?: ImportCandidate[];
  error?: string;
}
interface Detected { kind: string; detectedPaths: string[]; instanceCount?: number | null }
interface Dependencies {
  detect(): Promise<Detected[]>;
  list(launcher: string, path?: string): Promise<HostCandidate[]>;
  existing(): Promise<ImportSource[]>;
  enqueue(launcher: string, candidate: ImportCandidate, path?: string): Promise<unknown>;
  icon(path: string): string;
  publish(launchers: LauncherSummary[]): void;
  timeoutMs?: number;
  errorMessage?(error: unknown): string;
}

/** One owner for host discovery, scan reuse and serialized record/task creation. */
export function createLauncherImport(deps: Dependencies) {
  let detection: Promise<void> | undefined;
  let detected: Detected[] = [];
  let scans = new Map<string, Promise<ImportCandidate[]>>();
  let queue: Promise<unknown> = Promise.resolve();
  let discovered = false;
  let preload: Promise<void> | undefined;
  const [states, setStates] = createSignal<Record<string, CandidateState>>({}, { name: 'importCandidateStates' });
  // Foreground requests and preloads share the same two scan slots.
  let active = 0;
  const waiting: (() => void)[] = [];
  const schedule = <T>(work: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    const start = () => {
      active++;
      void work().then(resolve, reject).finally(() => { active--; waiting.shift()?.(); });
    };
    if (active < 2) start(); else waiting.push(start);
  });
  const bounded = async <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('launcher-import-timeout')), deps.timeoutMs ?? 20_000);
      })]);
    } finally { clearTimeout(timer); }
  };
  const publishLaunchers = () => deps.publish(detected.flatMap((row) => {
    const visual = findLauncher(row.kind);
    return visual && row.detectedPaths.length && row.instanceCount !== 0 ? [{ id: row.kind, label: visual.label,
      icon: `branding/${visual.icon}`, path: row.detectedPaths[0], instanceCount: row.instanceCount ?? undefined }] : [];
  }));
  const invalidate = () => { scans = new Map(); setStates({}); preload = undefined; };
  const normalize = (path?: string) => path?.trim() || undefined;
  const scanKey = (launcher: string, path?: string) => JSON.stringify([launcher, normalize(path)]);
  const refreshLaunchers = (): Promise<void> => {
    if (detection) return detection;
    // A refresh starts a fresh scan generation without letting old requests refill it.
    invalidate();
    detection = bounded(deps.detect()).then((rows) => {
      detected = rows;
      discovered = true;
      publishLaunchers();
    }).finally(() => { detection = undefined; });
    return detection;
  };
  const loadCandidates = (launcher: string, path?: string): Promise<ImportCandidate[]> => {
    const key = scanKey(launcher, path);
    const cached = scans.get(key);
    if (cached) return cached;
    const generation = scans;
    setStates((value) => ({ ...value, [key]: { status: 'loading' } }));
    const update = (state: CandidateState) => {
      if (generation === scans) setStates((value) => ({ ...value, [key]: state }));
    };
    const pending = schedule(async () => {
      // A refresh may invalidate work before it gets a slot.
      if (generation !== scans) throw new Error('launcher-import-invalidated');
      return bounded(Promise.all([deps.list(launcher, normalize(path)), deps.existing()]));
    }).then(([rows, existing]) =>
      rows.map((raw): ImportCandidate => {
        const date = raw.lastPlayedAtUnixMs == null ? undefined : new Date(raw.lastPlayedAtUnixMs);
        return { key: raw.instancePath, launcher, name: raw.name,
          minecraft: raw.minecraftVersion ?? undefined, loader: raw.modloader ?? undefined,
          iconUrl: raw.iconPath ? deps.icon(raw.iconPath) : undefined,
          lastPlayed: date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined,
          modCount: raw.modsCount ?? undefined,
          alreadyImported: existing.some((item) => item.importLauncherKind === launcher && item.importInstancePath === raw.instancePath), raw };
      }),
    ).then((candidates) => {
      update({ status: 'ready', candidates });
      if (generation === scans && !normalize(path)) {
        const row = detected.find((row) => row.kind === launcher);
        if (row) { row.instanceCount = candidates.length; publishLaunchers(); }
      }
      return candidates;
    }).catch((reason) => {
      generation.delete(key);
      const error = new Error(deps.errorMessage?.(reason) ?? String(reason instanceof Error ? reason.message : reason));
      update({ status: 'error', error: error.message });
      throw error;
    });
    generation.set(key, pending);
    return pending;
  };
  const importMany = (launcher: string, candidates: ImportCandidate[], path?: string): Promise<ImportResult> => {
    // Snapshot caller selection and serialize across overlapping batches too. The host
    // allocates unique names/directories before submitting each background copy task.
    const selected = [...candidates];
    const run = async (): Promise<ImportResult> => {
      const result: ImportResult = { queued: 0, failed: [] };
      for (const candidate of selected) {
        try {
          await deps.enqueue(launcher, candidate, normalize(path));
          result.queued++;
        } catch (error) { result.failed.push({ key: candidate.key, error: String(error) }); }
      }
      // Rescans must re-read persisted import origins, including partial successes.
      invalidate();
      return result;
    };
    const pending = queue.then(run);
    queue = pending.catch(() => undefined);
    return pending;
  };
  const ensureLaunchers = () => detection ?? (discovered ? Promise.resolve() : refreshLaunchers());
  const preloadLaunchers = (): Promise<void> => {
    if (preload) return preload;
    // refreshLaunchers invalidates preload synchronously; assign after starting it.
    const ready = ensureLaunchers();
    preload = ready.then(async () => {
      const generation = scans;
      const launchers = detected.filter((row) => row.detectedPaths.length && row.instanceCount !== 0);
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(2, launchers.length) }, async () => {
        while (generation === scans && index < launchers.length) {
          const launcher = launchers[index++];
          await loadCandidates(launcher.kind).catch(() => {});
        }
      }));
    }).catch((error) => { preload = undefined; throw error; });
    return preload;
  };
  return { refreshLaunchers, ensureLaunchers, loadCandidates, importMany, preloadLaunchers,
    candidateState: (launcher: string, path?: string): CandidateState => states()[scanKey(launcher, path)] ?? { status: 'idle' },
    detectedLauncherPaths: (launcher: string) => [...new Set(detected.find((row) => row.kind === launcher)?.detectedPaths.filter(Boolean) ?? [])] };
}
