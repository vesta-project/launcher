// Bounded console history for one server. Native code already batches and caps;
// this keeps the WebView bounded too. The agent pages forward only and lines
// evicted at a gap are gone, so a gap stays a visible marker.
import type { ConsoleLine } from './native';

export const CONSOLE_LINE_LIMIT = 5000;

/**
 * `id` orders entries within one buffer: it increases from top to bottom and never
 * repeats, even when a merged tail goes on top (those take ids below the first entry).
 * Cursors are opaque, so views use `id` for ordering and display boundaries.
 */
export type ConsoleEntry =
  | { key: string; id: number; kind: 'line'; cursor: string; text: string; truncated: boolean }
  | { key: string; id: number; kind: 'gap'; cursor: string };

const lineEntry = (line: ConsoleLine, id: number): Extract<ConsoleEntry, { kind: 'line' }> => ({
  key: `l:${line.cursor}`, id, kind: 'line', cursor: line.cursor, text: line.text, truncated: line.truncated,
});

const position = (cursor: string) => {
  const match = /^(.*\.console\.)([0-9]+)$/.exec(cursor);
  return match ? { scope: match[1], value: BigInt(match[2]) } : null;
};

/** Display clearing follows source position even if recovery rebuilds row ids. */
export interface ConsoleDisplayBoundary {
  hiddenUntil: number | null;
  hiddenAfterCursor: string | null;
}

export function clearConsoleDisplay(entries: readonly ConsoleEntry[]): ConsoleDisplayBoundary {
  return {
    hiddenUntil: (entries.at(-1)?.id ?? -1) + 1,
    hiddenAfterCursor: entries.findLast((entry) => entry.kind === 'line')?.cursor ?? null,
  };
}

export function consoleDisplayBoundary(entries: readonly ConsoleEntry[], boundary: ConsoleDisplayBoundary): number {
  if (boundary.hiddenUntil === null) return -Infinity;
  const after = boundary.hiddenAfterCursor ? position(boundary.hiddenAfterCursor) : null;
  if (!after) return boundary.hiddenUntil;
  let firstInScope: number | undefined;
  // The last hidden line determines the boundary. Walking back from the tail
  // avoids reparsing the retained history after every new console batch.
  for (let i = entries.length - 1; i >= 0; i--) {
    const current = entries[i].kind === 'line' ? position(entries[i].cursor) : null;
    if (current?.scope !== after.scope) continue;
    firstInScope = entries[i].id;
    if (current.value <= after.value) {
      for (let next = i + 1; next < entries.length; next++) {
        if (entries[next].kind === 'line') return entries[next].id;
      }
      return Infinity;
    }
  }
  return firstInScope ?? boundary.hiddenUntil;
}

export class ConsoleBuffer {
  readonly entries: ConsoleEntry[] = [];
  private readonly seen = new Set<string>();
  private gaps = 0;
  /** The next id at the bottom; a merged top counts down from the first entry instead. */
  private nextId = 0;
  dropped = 0;

  /** `limit` bounds all entries, gap markers included. */
  constructor(private readonly limit = CONSOLE_LINE_LIMIT) {}

  /** Appends live lines, skipping cursors already present. Returns how many were added. */
  append(lines: readonly ConsoleLine[]): number {
    let added = 0;
    for (const line of lines) {
      if (this.seen.has(line.cursor)) continue;
      this.seen.add(line.cursor);
      this.entries.push(lineEntry(line, this.nextId++));
      added++;
    }
    this.trim();
    return added;
  }

  /** Inserts a visible marker where the server skipped lines. Consecutive gaps collapse. */
  gap(cursor: string) {
    if (this.entries.at(-1)?.kind === 'gap') return;
    this.entries.push({ key: `g:${cursor}:${this.gaps++}`, id: this.nextId++, kind: 'gap', cursor });
    this.trim();
  }

  /**
   * Merges a page of the server's retained tail (oldest first). Lines before the first
   * line already shown go on top; later unseen lines are appended. With no overlap
   * the order relative to what is shown is unknown, so the page goes on top with a
   * gap marker between them rather than inventing continuity.
   */
  merge(lines: readonly ConsoleLine[]): number {
    if (!lines.length) return 0;
    if (lines.every((line) => this.seen.has(line.cursor))
      && !this.entries.some((entry, index) => entry.kind === 'gap' && index !== this.entries.length - 1)) return 0;
    const page = lines.map((line) => ({ line, position: position(line.cursor) }));
    const existing = this.entries.filter((entry) => entry.kind === 'line').map((entry) => ({ entry, position: position(entry.cursor) }));
    const scope = page[0].position?.scope;
    if (scope && page.every((item) => item.position?.scope === scope)
      && existing.every((item) => item.position?.scope === scope)) {
      // Order the combined history BEFORE eviction: appending an older recovery
      // page to a full live tail would otherwise discard newer live output.
      const combined = new Map(existing.map((item) => [item.entry.cursor, { entry: item.entry, value: item.position!.value }]));
      let added = 0;
      for (const item of page) {
        if (combined.has(item.line.cursor)) continue;
        combined.set(item.line.cursor, { entry: lineEntry(item.line, 0), value: item.position!.value });
        added++;
      }
      const ordered = [...combined.values()].sort((a, b) => {
        return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
      });
      const trailing = this.entries.at(-1);
      const trailingGap = trailing?.kind === 'gap' && existing.length
        && ordered.at(-1)!.value <= existing.at(-1)!.position!.value ? trailing : null;
      // Keep a visible marker only where retained cursors still prove missing output.
      this.entries.length = 0;
      this.seen.clear();
      let previous: bigint | null = null;
      for (const { entry, value: cursor } of ordered) {
        if (previous !== null && cursor > previous + 1n) {
          this.entries.push({ key: `g:${entry.cursor}:${this.gaps++}`, id: this.nextId++, kind: 'gap', cursor: entry.cursor });
        }
        // Parsed rows are cached by object identity. Never mutate a cached id.
        this.entries.push({ ...entry, id: this.nextId++ });
        this.seen.add(entry.cursor);
        previous = cursor;
      }
      // A tail marker is unresolved until recovery advances past the observed
      // tail. An older/duplicate page alone cannot prove that no output was lost.
      if (trailingGap) this.entries.push({ ...trailingGap, id: this.nextId++ });
      this.trim();
      return added;
    }
    const pageSeen = new Set<string>();
    const unique = lines.filter((line) => {
      if (pageSeen.has(line.cursor)) return false;
      pageSeen.add(line.cursor);
      return true;
    });
    const fresh = unique.filter((line) => !this.seen.has(line.cursor));
    if (!fresh.length) return 0;
    if (!this.entries.length) return this.append(lines);
    const overlap = unique.findIndex((line) => this.seen.has(line.cursor));
    const before = overlap < 0 ? fresh : unique.slice(0, overlap).filter((line) => !this.seen.has(line.cursor));
    const after = overlap < 0 ? [] : unique.slice(overlap).filter((line) => !this.seen.has(line.cursor));
    for (const line of before) this.seen.add(line.cursor);
    const base = this.entries[0].id - before.length - (overlap < 0 ? 1 : 0);
    const top: ConsoleEntry[] = before.map((line, index) => lineEntry(line, base + index));
    if (overlap < 0) top.push({ key: `g:merge:${this.gaps++}`, id: base + before.length, kind: 'gap', cursor: '' });
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
    const excess = this.entries.length - this.limit;
    if (excess <= 0) return;
    for (const removed of this.entries.splice(0, excess)) {
      if (removed.kind === 'line') {
        this.seen.delete(removed.cursor);
        this.dropped++;
      }
    }
  }
}
