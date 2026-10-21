// Data-source-agnostic rows for the log viewer. Instance logs pass parsed lines as
// they are; other sources (server consoles) add gap markers and truncation flags.
import { matchesLog, type ParsedLog } from "../../features/instances/interaction-utils";

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

/**
 * Entries at or after the display boundary that pass the level and text filters.
 * Gaps always pass the filters, since hiding one would invent continuity.
 */
export function filterLog(
  entries: readonly LogEntry[],
  hidden: number,
  levels: string[],
  query: string,
): LogEntry[] {
  return entries.filter(
    (entry) =>
      entry.id >= hidden &&
      (isGap(entry) || matchesLog(entry, levels, query)),
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
