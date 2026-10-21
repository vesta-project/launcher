// Bounded console history for one server. Native code already batches and caps;
// this keeps the WebView bounded too. The agent pages forward only and lines
// evicted at a gap are gone, so a gap stays a visible marker.
import type { ConsoleLine } from './native';

export const CONSOLE_LINE_LIMIT = 5000;

export type ConsoleEntry =
  | { key: string; kind: 'line'; cursor: string; text: string; truncated: boolean }
  | { key: string; kind: 'gap'; cursor: string };

const lineEntry = (line: ConsoleLine): ConsoleEntry => ({
  key: `l:${line.cursor}`, kind: 'line', cursor: line.cursor, text: line.text, truncated: line.truncated,
});

export class ConsoleBuffer {
  readonly entries: ConsoleEntry[] = [];
  private readonly seen = new Set<string>();
  private gaps = 0;
  dropped = 0;

  /** `limit` bounds all entries, gap markers included. */
  constructor(private readonly limit = CONSOLE_LINE_LIMIT) {}

  /** Appends live lines, skipping cursors already present. Returns how many were added. */
  append(lines: readonly ConsoleLine[]): number {
    let added = 0;
    for (const line of lines) {
      if (this.seen.has(line.cursor)) continue;
      this.seen.add(line.cursor);
      this.entries.push(lineEntry(line));
      added++;
    }
    this.trim();
    return added;
  }

  /** Inserts a visible marker where the server skipped lines. Consecutive gaps collapse. */
  gap(cursor: string) {
    if (this.entries.at(-1)?.kind === 'gap') return;
    this.entries.push({ key: `g:${cursor}:${this.gaps++}`, kind: 'gap', cursor });
    this.trim();
  }

  /**
   * Merges a page of the server's retained tail (oldest first). Lines before the first
   * line already shown go on top; later unseen lines are appended. With no overlap
   * the order relative to what is shown is unknown, so the page goes on top with a
   * gap marker between them rather than inventing continuity.
   */
  merge(lines: readonly ConsoleLine[]): number {
    const fresh = lines.filter((line) => !this.seen.has(line.cursor));
    if (!fresh.length) return 0;
    if (!this.entries.length) return this.append(lines);
    const overlap = lines.findIndex((line) => this.seen.has(line.cursor));
    const before = overlap < 0 ? fresh : lines.slice(0, overlap).filter((line) => !this.seen.has(line.cursor));
    const after = overlap < 0 ? [] : lines.slice(overlap).filter((line) => !this.seen.has(line.cursor));
    for (const line of before) this.seen.add(line.cursor);
    const top: ConsoleEntry[] = before.map(lineEntry);
    if (overlap < 0) top.push({ key: `g:merge:${this.gaps++}`, kind: 'gap', cursor: '' });
    this.entries.unshift(...top);
    this.trim();
    this.append(after);
    return before.length + after.length;
  }

  clear() {
    this.entries.length = 0;
    this.seen.clear();
    this.dropped = 0;
  }

  get lineCount() {
    return this.entries.reduce((count, entry) => count + (entry.kind === 'line' ? 1 : 0), 0);
  }

  /** Drops the oldest entries beyond the limit. */
  private trim() {
    while (this.entries.length > this.limit) {
      const removed = this.entries.shift()!;
      if (removed.kind === 'line') {
        this.seen.delete(removed.cursor);
        this.dropped++;
      }
    }
  }
}
