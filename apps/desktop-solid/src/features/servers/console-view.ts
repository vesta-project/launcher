// Adapts a server's console buffer to the shared log viewer and keeps each server's
// viewer settings for the session, so switching tabs or servers doesn't reset them.
import { createSignal, type Accessor } from 'solid-js';
import { parseLog } from '../instances/interaction-utils';
import { LOG_LEVELS, type LogEntry, type LogLineEntry, type LogViewState } from '../../components/log-view/log-model';
import type { ConsoleDisplayBoundary, ConsoleEntry } from './console-model';
import type { ConnectionId } from './native';

export interface GapCopy { label: string; detail?: string }

/**
 * Maps buffer entries to viewer rows. Lines are parsed once per entry object (the
 * cache holds them while the buffer does), so a new line doesn't re-parse the rest.
 */
export function toLogEntries(entries: readonly ConsoleEntry[], gap: GapCopy, cache: WeakMap<ConsoleEntry, LogEntry>): LogEntry[] {
  const rows = new Array<LogEntry>(entries.length);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.kind === 'gap') {
      rows[index] = { kind: 'gap', id: entry.id, label: gap.label, detail: gap.detail };
      continue;
    }
    let row = cache.get(entry);
    if (!row) {
      // parseLog returns a fresh row; attach viewer fields without allocating a second copy.
      const parsed = parseLog(entry.text, entry.id) as LogLineEntry;
      parsed.kind = 'line';
      parsed.truncated = entry.truncated;
      row = parsed;
      cache.set(entry, row);
    }
    rows[index] = row;
  }
  return rows;
}

export interface ServerConsoleViewState extends LogViewState, ConsoleDisplayBoundary {}

const views = new Map<ConnectionId, [Accessor<ServerConsoleViewState>, (next: Partial<ServerConsoleViewState>) => void]>();

/** One viewer state per server, created on first use and kept for the session. */
export function serverConsoleView(id: ConnectionId) {
  let view = views.get(id);
  if (!view) {
    const [state, setState] = createSignal<ServerConsoleViewState>(
      { query: '', levels: [...LOG_LEVELS], follow: true, wrap: true, hiddenUntil: null, hiddenAfterCursor: null },
      { name: `server-console-view:${id}` },
    );
    view = [state, (next) => setState((current) => ({ ...current, ...next }))];
    views.set(id, view);
  }
  return view;
}
