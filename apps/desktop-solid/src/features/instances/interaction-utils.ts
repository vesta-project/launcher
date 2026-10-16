/** Select-all affects only the filtered scope, retaining selections outside it. */
export function selectVisible(
  selected: string[],
  visible: string[],
  on: boolean,
): string[] {
  const scope = new Set(visible);
  return on
    ? [...new Set([...selected, ...visible])]
    : selected.filter((id) => !scope.has(id));
}
export type LogLevel =
  | "INFO"
  | "WARN"
  | "ERROR"
  | "DEBUG"
  | "FATAL"
  | "UNKNOWN";
export interface ParsedLog {
  id: number;
  timestamp: string;
  level: LogLevel;
  thread: string;
  message: string;
  raw: string;
}
/** Same log4j shape and raw fallback as the original console store. */
export function parseLog(raw: string, id: number): ParsedLog {
  const match = raw.match(
    /^\[(\d{2}:\d{2}:\d{2})\]\s+\[([^/]+)\/([^\]]+)\]:\s+(.*)$/,
  );
  const valid: LogLevel[] = ["INFO", "WARN", "ERROR", "DEBUG", "FATAL"];
  const level = match?.[3].toUpperCase() as LogLevel;
  return match
    ? {
        id,
        timestamp: match[1],
        thread: match[2],
        level: valid.includes(level) ? level : "UNKNOWN",
        message: match[4],
        raw,
      }
    : { id, timestamp: "", thread: "", level: "UNKNOWN", message: raw, raw };
}
export function matchesLog(line: ParsedLog, levels: string[], query: string) {
  return (
    (line.level === "UNKNOWN" ||
      levels.includes(line.level === "FATAL" ? "ERROR" : line.level)) &&
    line.raw.toLowerCase().includes(query.toLowerCase())
  );
}
