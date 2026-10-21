// Adapts a server's console buffer to the shared log viewer and keeps each server's
// viewer settings for the session, so switching tabs or servers doesn't reset them.
import { createSignal, type Accessor } from 'solid-js';
import { parseLog } from '../instances/interaction-utils';
import { LOG_LEVELS, type LogEntry, type LogViewState } from '../../components/log-view/log-model';
import type { ConsoleEntry } from './console-model';
import type { ConnectionId } from './native';

export interface GapCopy { label: string; detail?: string }

/**
 * Maps buffer entries to viewer rows. Lines are parsed once per entry object (the
 * cache holds them while the buffer does), so a new line doesn't re-parse the rest.
 */
export function toLogEntries(entries: readonly ConsoleEntry[], gap: GapCopy, cache: WeakMap<ConsoleEntry, LogEntry>): LogEntry[] {
  return entries.map((entry) => {
    if (entry.kind === 'gap') return { kind: 'gap', id: entry.id, label: gap.label, detail: gap.detail };
    let row = cache.get(entry);
    if (!row) {
      row = { ...parseLog(entry.text, entry.id), kind: 'line', truncated: entry.truncated };
      cache.set(entry, row);
    }
    return row;
  });
}

export interface ServerConsoleViewState extends LogViewState {
  /** Entries before this id are hidden by "Clear display"; null shows everything. */
  hiddenUntil: number | null;
}

const views = new Map<ConnectionId, [Accessor<ServerConsoleViewState>, (next: Partial<ServerConsoleViewState>) => void]>();

/** One viewer state per server, created on first use and kept for the session. */
export function serverConsoleView(id: ConnectionId) {
  let view = views.get(id);
  if (!view) {
    const [state, setState] = createSignal<ServerConsoleViewState>(
      { query: '', levels: [...LOG_LEVELS], follow: true, wrap: true, hiddenUntil: null },
      { name: `server-console-view:${id}` },
    );
    view = [state, (next) => setState((current) => ({ ...current, ...next }))];
    views.set(id, view);
  }
  return view;
}
