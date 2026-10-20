import { findLauncher } from '../installation/launchers';
import type { HostCandidate, ImportCandidate, ImportResult, LauncherSummary } from './model';

export interface ImportSource {
  importLauncherKind?: string | null;
  importInstancePath?: string | null;
}
interface Detected { kind: string; detectedPaths: string[] }
interface Dependencies {
  detect(): Promise<Detected[]>;
  list(launcher: string, path?: string): Promise<HostCandidate[]>;
  existing(): Promise<ImportSource[]>;
  enqueue(launcher: string, candidate: ImportCandidate, path?: string): Promise<unknown>;
  icon(path: string): string;
  publish(launchers: LauncherSummary[]): void;
}

/** One owner for host discovery, scan reuse and serialized record/task creation. */
export function createLauncherImport(deps: Dependencies) {
  let detection: Promise<void> | undefined;
  let detected: Detected[] = [];
  let scans = new Map<string, Promise<ImportCandidate[]>>();
  let queue: Promise<unknown> = Promise.resolve();
  const normalize = (path?: string) => path?.trim() || undefined;
  const scanKey = (launcher: string, path?: string) => JSON.stringify([launcher, normalize(path)]);
  const refreshLaunchers = (): Promise<void> => {
    if (detection) return detection;
    // A refresh starts a fresh scan generation without letting old requests refill it.
    scans = new Map();
    detection = deps.detect().then((rows) => {
      detected = rows;
      deps.publish(rows.flatMap((row) => {
        const visual = findLauncher(row.kind);
        return visual && row.detectedPaths.length ? [{ id: row.kind, label: visual.label,
          icon: `branding/${visual.icon}`, path: row.detectedPaths[0] }] : [];
      }));
    }).finally(() => { detection = undefined; });
    return detection;
  };
  const loadCandidates = (launcher: string, path?: string): Promise<ImportCandidate[]> => {
    const key = scanKey(launcher, path);
    const cached = scans.get(key);
    if (cached) return cached;
    const generation = scans;
    const pending = Promise.all([deps.list(launcher, normalize(path)), deps.existing()]).then(([rows, existing]) =>
      rows.map((raw): ImportCandidate => {
        const date = raw.lastPlayedAtUnixMs == null ? undefined : new Date(raw.lastPlayedAtUnixMs);
        return { key: raw.instancePath, launcher, name: raw.name,
          minecraft: raw.minecraftVersion ?? undefined, loader: raw.modloader ?? undefined,
          iconUrl: raw.iconPath ? deps.icon(raw.iconPath) : undefined,
          lastPlayed: date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined,
          modCount: raw.modsCount ?? undefined,
          alreadyImported: existing.some((item) => item.importLauncherKind === launcher && item.importInstancePath === raw.instancePath), raw };
      }),
    ).catch((error) => { generation.delete(key); throw error; });
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
      scans.clear();
      return result;
    };
    const pending = queue.then(run);
    queue = pending.catch(() => undefined);
    return pending;
  };
  return { refreshLaunchers, loadCandidates, importMany,
    detectedLauncherPaths: (launcher: string) => [...new Set(detected.find((row) => row.kind === launcher)?.detectedPaths.filter(Boolean) ?? [])] };
}
