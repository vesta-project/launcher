// Backups as a git history. Each restore point knows the point the world descended from
// (`parentId`), and the server knows which point the live world descends from now (`head`).
// Restoring an old point and playing on grows a new branch; the old one stays.
//
// Types mirror the agent's `GET backups/history` (see native-backup-history.ts).

export interface BackupPoint { id: string; time: string; profile: string | null; safety: boolean; parentId: string | null; label: string | null; kept: boolean }
export interface BackupHistory { head: string | null; points: BackupPoint[] }

/** The live world: a row above its point, in a branch of its own once it has left the tip. */
export const LIVE = 'live';

/** A line segment in one lane; `live` when it is part of the live world's ancestry. */
export interface GraphLine { lane: number; live: boolean }

export interface GraphRow {
  /** A point id, or LIVE. */
  id: string;
  point: BackupPoint | null;
  /** The lane this row's node sits in. */
  lane: number;
  /** The live world descends from this point (or this is the live world). */
  live: boolean;
  /** Lanes passing straight through this row (another branch carries on beside it). */
  through: GraphLine[];
  /** The line coming down into the node from its first child above, if any. */
  above: GraphLine | null;
  /** Other children above: branches that curve into this node from their own lanes. */
  joins: GraphLine[];
  /** The line leaving the node for its parent below. */
  below: GraphLine | null;
  /** The newest point of a branch (nothing was backed up on top of it). */
  tip: boolean;
}

const LABEL_LIMIT = 60;
export const labelProblem = (label: string) => label.trim().length > LABEL_LIMIT ? 'servers.backups.label-long' as const : null;
export const cleanLabel = (label: string) => label.trim() || null;

/**
 * An agent without lineage reports every parent as null and no head. Read that as one line in
 * time order, so older servers still get a history (just without branches).
 */
export function withLineage(history: BackupHistory): BackupHistory {
  const points = [...history.points].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  if (history.head !== null || points.some((point) => point.parentId !== null)) return { head: history.head, points };
  return { head: points[0]?.id ?? null, points: points.map((point, index) => ({ ...point, parentId: points[index + 1]?.id ?? null })) };
}

/**
 * Lays the history out in lanes, newest first, like `git log --graph`. The live world is the
 * first row. A point's first child (top to bottom) keeps its lane; every other child is a branch
 * that curves into it. Parents missing from the listing end their lane.
 */
export function graphRows(input: BackupHistory): GraphRow[] {
  const history = withLineage(input);
  const byId = new Map(history.points.map((point) => [point.id, point]));
  const parentOf = (point: BackupPoint) => (point.parentId && byId.has(point.parentId) ? point.parentId : null);
  const liveParent = history.head && byId.has(history.head) ? history.head : null;
  const children = new Map<string, number>();
  for (const point of history.points) { const parent = parentOf(point); if (parent) children.set(parent, (children.get(parent) ?? 0) + 1); }
  if (liveParent) children.set(liveParent, (children.get(liveParent) ?? 0) + 1);
  // The live world's ancestry, drawn in the accent colour.
  const ancestry = new Set<string>([LIVE]);
  for (let id = liveParent; id; id = parentOf(byId.get(id)!)) ancestry.add(id);

  const rows: GraphRow[] = [];
  // Each lane waits for a point below (`expect`), drawn from the child that opened it (`from`).
  const lanes: ({ expect: string; from: string } | null)[] = [];
  const place = (id: string, point: BackupPoint | null, parent: string | null) => {
    const waiting = lanes.flatMap((entry, index) => (entry?.expect === id ? [index] : []));
    let lane = waiting[0] ?? lanes.indexOf(null);
    if (lane < 0) lane = lanes.length;
    const line = (index: number): GraphLine => ({ lane: index, live: ancestry.has(lanes[index]!.from) });
    const through = lanes.flatMap((entry, index) => (entry && entry.expect !== id && index !== lane ? [line(index)] : []));
    const above = waiting.length ? line(waiting[0]!) : null;
    const joins = waiting.slice(1).map(line);
    for (const index of waiting) lanes[index] = null;
    lanes[lane] = parent ? { expect: parent, from: id } : null;
    rows.push({ id, point, lane, live: ancestry.has(id), through, above, joins, below: parent ? { lane, live: ancestry.has(id) } : null, tip: point !== null && !children.get(id) });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  };
  place(LIVE, null, liveParent);
  for (const point of history.points) place(point.id, point, parentOf(point));
  return rows;
}

/** How many lanes the graph needs, for its width. */
export const laneCount = (rows: GraphRow[]) => rows.reduce((max, row) => Math.max(max, row.lane + 1, ...row.through.map((line) => line.lane + 1), ...row.joins.map((line) => line.lane + 1)), 1);

/** The live world sits on a point's branch only while nothing was backed up after it. */
export const liveIsBranch = (history: BackupHistory) => {
  const lineage = withLineage(history);
  return !!lineage.head && lineage.points.some((point) => point.parentId === lineage.head);
};
