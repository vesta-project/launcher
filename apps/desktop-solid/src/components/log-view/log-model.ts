// Data-source-agnostic rows for the log viewer. Instance logs pass parsed lines as
// they are; other sources (server consoles) add gap markers and truncation flags.
import type { ParsedLog } from "../../features/instances/interaction-utils";

/** A parsed line. `kind` is optional so plain `ParsedLog` arrays are valid entries. */
export interface LogLineEntry extends ParsedLog {
  kind?: "line";
  /** The source cut this line short. */
  truncated?: boolean;
}

/** A marker where the source skipped lines. Ids order it among the lines. */
export interface LogGapEntry {
  kind: "gap";
  id: number;
  label: string;
  detail?: string;
}

export type LogEntry = LogLineEntry | LogGapEntry;

/** Viewer settings the owner keeps, so they survive tab switches. */
export interface LogViewState {
  query: string;
  levels: string[];
  follow: boolean;
  wrap: boolean;
}

export const LOG_LEVELS =["INFO", "WARN", "ERROR", "DEBUG"] as const;

export const isGap = (entry: LogEntry): entry is LogGapEntry =>
  entry.kind === "gap";

/** Unprefixed physical lines continue the preceding entry until a parsed
 * header or source gap starts another entry. Raw text stays intact. */
export function groupLogEntries(
  entries: readonly LogEntry[],
  continuations?: WeakMap<LogLineEntry, LogLineEntry>,
): readonly LogEntry[] {
  let previous: LogLineEntry | undefined;
  let grouped: LogEntry[] | undefined;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (isGap(entry)) {
      previous = undefined;
    } else if (entry.level === "UNKNOWN" && !entry.timestamp && !entry.thread) {
      if (previous && (previous.level !== entry.level || previous.thread !== entry.thread)) {
        let row = continuations?.get(entry);
        if (row?.level !== previous.level || row.thread !== previous.thread) {
          row = { ...entry, level: previous.level, thread: previous.thread };
          continuations?.set(entry, row);
        }
        grouped ??= entries.slice(0, index);
        grouped.push(row);
        continue;
      }
    } else {
      previous = entry;
    }
    grouped?.push(entry);
  }
  return grouped ?? entries;
}

/**
 * Entries at or after the display boundary that pass the level and text filters.
 * Gaps always pass the filters, since hiding one would invent continuity.
 */
export function filterLog(
  entries: readonly LogEntry[],
  hidden: number,
  levels: string[],
  query: string,
): readonly LogEntry[] {
  const search = query.toLowerCase();
  const allLevels = LOG_LEVELS.every((level) => levels.includes(level));
  if (!search && allLevels && (entries[0]?.id ?? 0) >= hidden) return entries;
  return entries.filter(
    (entry) =>
      entry.id >= hidden &&
      (isGap(entry) ||
        ((allLevels || entry.level === "UNKNOWN" || levels.includes(entry.level === "FATAL" ? "ERROR" : entry.level)) &&
          (!search || entry.raw.toLowerCase().includes(search)))),
  );
}

/** Lines per filter level (FATAL counts as ERROR). Gap markers are not lines. */
export function levelCounts(entries: readonly LogEntry[]) {
  const result: Record<string, number> = {};
  for (const entry of entries) {
    if (isGap(entry)) continue;
    const level = entry.level === "FATAL" ? "ERROR" : entry.level;
    result[level] = (result[level] ?? 0) + 1;
  }
  return result;
}

/** Number of real lines, excluding gap markers. */
export const lineTotal = (entries: readonly LogEntry[]) =>
  entries.reduce((count, entry) => count + (isGap(entry) ? 0 : 1), 0);

/** Clipboard text. Gaps stay visible in the copy so pasted output never reads as continuous. */
export const logText = (entries: readonly LogEntry[]) =>
  entries
    .map((entry) =>
      isGap(entry)
        ? `--- ${entry.label}${entry.detail ? ` · ${entry.detail}` : ""} ---`
        : entry.raw,
    )
    .join("\n");
