import type { PlayersView } from './native';
export interface RosterDelta { generation: string; base_revision: string; revision: string; changes: { name: string; kind: 'join' | 'leave' }[] }
export function applyRosterDelta(current: PlayersView, delta: RosterDelta): PlayersView | null {
  if (!delta || typeof delta.revision !== "string" || !current.known || current.generation !== delta.generation || current.revision !== delta.base_revision || !Array.isArray(delta.changes)) return null;
  const names = new Set(current.names);
  for (const change of delta.changes) {
    if (!change || !/^[A-Za-z0-9_]{1,16}$/.test(change.name) || !['join', 'leave'].includes(change.kind)) return null;
    if (change.kind === 'join') names.add(change.name); else names.delete(change.name);
  }
  return { ...current, names: [...names], playerCount: names.size, revision: delta.revision };
}
