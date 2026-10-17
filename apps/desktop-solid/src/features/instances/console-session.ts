import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { nativeInstances, nativeRecord, reportInstanceError } from './native-service';
import { instanceSlug } from './native-model';
import { logCatchup } from './native-details-model';
import { createSignal, untrack } from "solid-js";
import { logFor } from "./details";
import { parseLog, type ParsedLog } from "./interaction-utils";

export interface LogSource {
  id: string;
  name: string;
  path?: string;
  kind: "live" | "file";
  size: string;
  modified: string;
}
export const logSources: LogSource[] = [
  {
    id: "live",
    name: "Live output",
    kind: "live",
    size: "",
    modified: "Current launcher capture",
  },
  {
    id: "session",
    name: "Launcher session.log",
    path: "data/logs/instance.log",
    kind: "file",
    size: "18 KB",
    modified: "Today, 18:42",
  },
  {
    id: "latest",
    name: "latest.log",
    path: "logs/latest.log",
    kind: "file",
    size: "24 KB",
    modified: "Today, 18:42",
  },
  {
    id: "archive",
    name: "2026-10-14-1.log.gz",
    path: "logs/2026-10-14-1.log.gz",
    kind: "file",
    size: "7 KB",
    modified: "Yesterday, 21:08",
  },
];
const MAX_LINES = 5000;
// Host events can contain a stack trace chunk. Each physical line needs its own
// identity and 20px slot when wrapping is disabled.
function physicalLines(raw: readonly string[]): string[] {
  return raw.flatMap((chunk) => chunk.replace(/\r?\n$/, "").split(/\r?\n/));
}
function fixtureLines(id: string, source: string): ParsedLog[] {
  if (source === "session")
    return [
      "[18:12:58] [main/INFO]: Preparing instance files",
      "[18:12:58] [main/INFO]: Verified 1,284 assets",
      "[18:12:59] [main/INFO]: Java 21.0.4 selected (bundled runtime)",
      "[18:12:59] [main/INFO]: Launching with 8192 MB heap",
      "[18:42:13] [main/WARN]: Game exited with code -1",
      "[18:42:13] [main/INFO]: Crash report written to crash-reports/crash-2026-10-15_18.42.12-client.txt",
    ].map((raw, index) => parseLog(raw, index));
  if (source === "archive")
    return [
      "[20:31:02] [main/INFO]: Loading Minecraft with Fabric Loader 0.16.9",
      "[20:31:09] [main/INFO]: Loading 24 mods",
      "[20:31:40] [Render thread/INFO]: Setting user: PlayerOne",
      "[20:33:11] [Server thread/INFO]: Starting integrated minecraft server",
      "[20:33:15] [Server thread/INFO]: PlayerOne joined the game",
      "[20:58:30] [Server thread/WARN]: Can't keep up! Is the server overloaded? Running 2210ms behind",
      "[21:08:44] [Server thread/INFO]: Stopping server",
      "[21:08:44] [Server thread/INFO]: Saving chunks for level 'New World'",
      "[21:08:45] [Render thread/INFO]: Stopping!",
    ].map((raw, index) => parseLog(raw, index));
  const lines = logFor(id).map(
    (line) => `[${line.time}] ${line.text.replace(/\] /, "]: ")}`,
  );
  lines.push(
    "[18:42:12] [Render thread/ERROR]: java.lang.OutOfMemoryError: Java heap space",
    "\tat net.minecraft.world.level.chunk.PalettedContainer.<init>(PalettedContainer.java:84)",
    "\tat net.minecraft.server.level.ChunkMap.tick(ChunkMap.java:612)",
  );
  return lines.map((raw, index) => parseLog(raw, index));
}
function createSession(id: string) {
  const [state, setState] = createSignal(
    {
      source: "live",
      query: "",
      levels: ["INFO", "WARN", "ERROR", "DEBUG"],
      follow: true,
      wrap: true,
      hiddenUntil: {} as Record<string, number>,
    },
    { name: `console:${id}` },
  );
  const [live, setLive] = createSignal(nativeInstances ? [] : fixtureLines(id, "live"), {
    name: `console-lines:${id}`,
  });
  const files = new Map(
    (nativeInstances ? [] : logSources)
      .filter((source) => source.kind === "file")
      .map((source) => [source.id, fixtureLines(id, source.id)]),
  );
  const [sources, setSources] = createSignal(nativeInstances ? [logSources[0]] : logSources, { name: `console-sources:${id}` });
  const [fileLines, setFileLines] = createSignal<ParsedLog[]>([], { name: `console-file-lines:${id}` });
  let selectionRevision = 0;
  let pending: string[] = [];
  let pendingCount = 0;
  let appendFrame: number | undefined;
  const flushAppends = () => {
    if (appendFrame !== undefined) cancelAnimationFrame(appendFrame);
    appendFrame = undefined;
    if (!pending.length) return;
    const raw = pending, received = pendingCount;
    pending = [];
    pendingCount = 0;
    setLive((current) => {
      const base = (current.at(-1)?.id ?? -1) + 1 + received - raw.length;
      return [
        ...(raw.length < MAX_LINES ? current.slice(-(MAX_LINES - raw.length)) : []),
        ...raw.map((line, index) => parseLog(line, base + index)),
      ].slice(-MAX_LINES);
    });
  };
  const lines = () =>
    state().source === "live" ? live() : (nativeInstances ? fileLines() : files.get(state().source) ?? []);
  return {
    state,
    setState,
    lines,
    sources,
    async choose(source: string) {
      const revision = ++selectionRevision;
      setState((current) => ({ ...current, source, follow: source === 'live' }));
      if (!nativeInstances || source === 'live') return;
      setFileLines([]);
      const file = sources().find((entry) => entry.id === source);
      if (!file?.path) return;
      try {
        const raw = await invoke<string[]>('read_specific_log_file', { path: file.path });
        if (revision === selectionRevision) setFileLines(physicalLines(raw).slice(-MAX_LINES).map(parseLog));
      } catch (reason) { if (revision === selectionRevision) reportInstanceError(reason); }
    },
    connect() {
      if (!nativeInstances) return () => {};
      const record = nativeRecord(id); if (!record) return () => {};
      const slug = instanceSlug(record.name);
      let disposed = false, catchingUp = true;
      let queued: string[] = [];
      const stops: (() => void)[] = [];
      const keep = (stop: () => void) => disposed ? stop() : stops.push(stop);
      let captureRevision = 0;
      const replace = (raw: string[]) => {
        const tail = physicalLines(raw).slice(-MAX_LINES), previous = live();
        const overlap = logCatchup(previous.map((line) => line.raw), tail).length - previous.length;
        const shared = tail.length - overlap;
        const base = shared > 0 ? (previous.at(-shared)?.id ?? 0) : (previous.at(-1)?.id ?? -1) + 1;
        setLive(tail.map((line, index) => parseLog(line, base + index)));
      };
      const refresh = async () => {
        const revision = ++captureRevision;
        flushAppends();
        catchingUp = true;
        queued = [];
        try {
          const raw = await invoke<string[]>('read_instance_log', { instanceIdSlug: slug, lastLines: MAX_LINES });
          if (!disposed && revision === captureRevision) replace(logCatchup(raw, queued));
        } catch (reason) { if (!disposed && revision === captureRevision) { this.append(queued); reportInstanceError(reason); } }
        finally { if (revision === captureRevision) { catchingUp = false; queued = []; } }
        try {
          const history = await invoke<{name:string;path:string;size:number;last_modified:number}[]>('get_instance_log_history', { instanceIdSlug: slug });
          if (!disposed && revision === captureRevision) {
            setSources([logSources[0], ...history.map((file) => ({ id: file.path, path: file.path, name: file.name, kind: 'file' as const, size: `${Math.ceil(file.size / 1024)} KB`, modified: new Date(file.last_modified * 1000).toLocaleString() }))]);
            if (!sources().some((source) => source.id === state().source)) {
              setState((current) => ({ ...current, source: 'live', follow: true }));
              setFileLines([]);
            }
          }
        } catch (reason) { if (!disposed) reportInstanceError(reason); }
      };
      const register = <T>(event: string, receive: (payload: T) => void) => listen<T>(event, ({payload}) => { if (!disposed) receive(payload); }).then(keep);
      void Promise.all([
        register<{lines:{instance_id:string;line:string}[]}>('core://instance-log', ({lines}) => {
          const raw = lines.filter((line) => line.instance_id === slug).map((line) => line.line);
          if (catchingUp) queued = [...queued, ...raw].slice(-MAX_LINES); else this.append(raw);
        }),
        register<{instance_id:string}>('core://instance-launched', (value) => { if (value.instance_id === slug) void untrack(refresh); }),
        register<{instance_id:string}>('core://instance-exited', (value) => { if (value.instance_id === slug) void untrack(refresh); }),
      ]).then(() => { if (!disposed) void refresh(); }).catch(reportInstanceError);
      const focus = () => { if (!catchingUp) void refresh(); };
      window.addEventListener('focus', focus);
      return () => { disposed = true; flushAppends(); selectionRevision++; stops.forEach((stop) => stop()); window.removeEventListener('focus', focus); };
    },
    append(raw: string[]) {
      if (!raw.length) return;
      const lines = physicalLines(raw);
      pendingCount += lines.length;
      pending = [...pending, ...lines].slice(-MAX_LINES);
      if (appendFrame === undefined) appendFrame = requestAnimationFrame(flushAppends);
    },
    clearDisplay() {
      // Solid commits signal writes later in the turn. Include queued IDs before
      // flushing, so pre-clear events cannot reappear when that write commits.
      const boundary = (lines().at(-1)?.id ?? -1) + 1 + (state().source === "live" ? pendingCount : 0);
      flushAppends();
      setState((current) => ({
        ...current,
        hiddenUntil: {
          ...current.hiddenUntil,
          [current.source]: boundary,
        },
      }));
    },
    restoreDisplay() {
      setState((current) => ({
        ...current,
        hiddenUntil: { ...current.hiddenUntil, [current.source]: 0 },
      }));
    },
  };
}
// Isolated preview sessions mirror the original console's per-instance ownership.
// Native capture and history attach only while the console view is mounted.
const sessions = new Map<string, ReturnType<typeof createSession>>();
export function consoleSession(id: string) {
  let session = sessions.get(id);
  if (!session) {
    session = createSession(id);
    sessions.set(id, session);
    const oldest = sessions.keys().next().value;
    if (sessions.size > 6 && oldest !== undefined) sessions.delete(oldest);
  }
  return session;
}
