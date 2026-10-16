import { createSignal } from "solid-js";
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
  const [live, setLive] = createSignal(fixtureLines(id, "live"), {
    name: `console-lines:${id}`,
  });
  const files = new Map(
    logSources
      .filter((source) => source.kind === "file")
      .map((source) => [source.id, fixtureLines(id, source.id)]),
  );
  const lines = () =>
    state().source === "live" ? live() : (files.get(state().source) ?? []);
  return {
    state,
    setState,
    lines,
    append(raw: string[]) {
      setLive((current) =>
        [
          ...current,
          ...raw.map((line, index) =>
            parseLog(line, (current.at(-1)?.id ?? -1) + 1 + index),
          ),
        ].slice(-MAX_LINES),
      );
    },
    clearDisplay() {
      setState((current) => ({
        ...current,
        hiddenUntil: {
          ...current.hiddenUntil,
          [current.source]: (lines().at(-1)?.id ?? -1) + 1,
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
// Native capture/history, IPC lifecycle and gzip reads remain in stores/console.ts.
const sessions = new Map<string, ReturnType<typeof createSession>>();
export function consoleSession(id: string) {
  let session = sessions.get(id);
  if (!session) {
    session = createSession(id);
    sessions.set(id, session);
  }
  return session;
}
