// Bounded console history for one server. Native code already batches and caps;
// this keeps the WebView bounded too and merges overlapping page/stream lines.
import type { ConsoleLine } from './native';

export const CONSOLE_LINE_LIMIT = 5000;

export type ConsoleEntry =
  | { key: string; kind: 'line'; cursor: string; text: string; truncated: boolean }
  | { key: string; kind: 'gap'; cursor: string; recovered: boolean };

export class ConsoleBuffer {
  readonly entries: ConsoleEntry[] = [];
  private readonly seen = new Set<string>();
  private gaps = 0;
  dropped = 0;

  constructor(private readonly limit = CONSOLE_LINE_LIMIT) {}

  /** Appends live lines, skipping cursors already present. Returns how many were added. */
  append(lines: readonly ConsoleLine[]): number {
    let added = 0;
    for (const line of lines) {
      if (this.seen.has(line.cursor)) continue;
      this.seen.add(line.cursor);
      this.entries.push({ key: `l:${line.cursor}`, kind: 'line', cursor: line.cursor, text: line.text, truncated: line.truncated });
      added++;
    }
    this.trim();
    return added;
  }

  /** Inserts a visible marker where the server skipped lines. */
  gap(cursor: string) {
    const last = this.entries.at(-1);
    if (last?.kind === 'gap' && !last.recovered) return;
    this.entries.push({ key: `g:${cursor}:${this.gaps++}`, kind: 'gap', cursor, recovered: false });
    this.trim();
  }

  /** Older lines fetched on request, inserted before the first known entry. */
  prepend(lines: readonly ConsoleLine[]): number {
    const fresh = lines.filter((line) => !this.seen.has(line.cursor));
    for (const line of fresh) this.seen.add(line.cursor);
    this.entries.unshift(...fresh.map((line) => ({
      key: `l:${line.cursor}`, kind: 'line' as const, cursor: line.cursor, text: line.text, truncated: line.truncated,
    })));
    this.trim(true);
    return fresh.length;
  }

  /** Lines recovered for a gap go right after the marker, which then stays as a record of the gap. */
  fill(gapKey: string, lines: readonly ConsoleLine[]): number {
    const at = this.entries.findIndex((entry) => entry.key === gapKey);
    if (at < 0) return 0;
    const gap = this.entries[at];
    if (gap.kind === 'gap') this.entries[at] = { ...gap, recovered: true };
    const fresh = lines.filter((line) => !this.seen.has(line.cursor));
    for (const line of fresh) this.seen.add(line.cursor);
    this.entries.splice(at + 1, 0, ...fresh.map((line) => ({
      key: `l:${line.cursor}`, kind: 'line' as const, cursor: line.cursor, text: line.text, truncated: line.truncated,
    })));
    this.trim();
    return fresh.length;
  }

  clear() {
    this.entries.length = 0;
    this.seen.clear();
    this.dropped = 0;
  }

  get lineCount() {
    return this.entries.reduce((count, entry) => count + (entry.kind === 'line' ? 1 : 0), 0);
  }

  private trim(fromEnd = false) {
    let excess = this.lineCount - this.limit;
    while (excess > 0 && this.entries.length) {
      const removed = fromEnd ? this.entries.pop()! : this.entries.shift()!;
      if (removed.kind === 'line') {
        this.seen.delete(removed.cursor);
        this.dropped++;
        excess--;
      }
    }
  }
}
