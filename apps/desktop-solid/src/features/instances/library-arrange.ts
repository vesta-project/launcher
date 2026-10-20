/**
 * Pure arranging rules for the library, ported from the old launcher's organizer. No DOM
 * reads: the pointer controller measures once and passes plain rectangles in.
 */
import type { LibraryEntry } from './library-layout';

/** How long a card must be held over another's middle before the pair would group. */
export const GROUP_DWELL_MS = 160;
/** How long the grid is left to finish animating after a live reorder before re-measuring. */
export const SETTLE_MS = 240;
/** Reorder animation length. */
export const FLIP_MS = 260;
export const FLIP_EASING = 'cubic-bezier(.22, 1, .36, 1)';
/** Carried preview size, and once held over a card that would form a group. */
export const CARRY_SCALE = 0.9;
export const GROUP_SCALE = 0.55;
/** Autoscroll: band at the scroller's edges and the fastest step per frame. */
export const SCROLL_EDGE = 60;
export const SCROLL_MAX_STEP = 14;
/** How far the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;
/** Clicks right after a drag are the drop, not a request to open. */
export const CLICK_SUPPRESS_MS = 250;

export interface Point {
  x: number;
  y: number;
}
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const within = (box: Box, point: Point) =>
  point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;

/** The middle half of a card: holding here groups, the edges reorder. */
export const inMiddle = (box: Box, point: Point) => {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  return within({
    left: box.left + width / 4,
    right: box.right - width / 4,
    top: box.top + height / 4,
    bottom: box.bottom - height / 4,
  }, point);
};

/** The right half inserts after a card, the left half before it. */
export const pastCentre = (box: Box, point: Point) => point.x > (box.left + box.right) / 2;

export interface MeasuredItem {
  entry: LibraryEntry;
  box: Box;
}

/** The item under the point. Items do not overlap in a grid, so the first hit wins. */
export function itemAt(items: readonly MeasuredItem[], point: Point, exclude?: LibraryEntry) {
  for (const item of items) if (item.entry !== exclude && within(item.box, point)) return item;
  return undefined;
}

/**
 * The item closest to a point that is over a gap, and which side of it the point is on.
 * Below a card's bottom edge or right of its centre counts as after it.
 */
export function nearestSlot(items: readonly MeasuredItem[], point: Point, exclude: LibraryEntry) {
  let best: { entry: LibraryEntry; after: boolean } | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const { entry, box } of items) {
    if (entry === exclude) continue;
    const distance = Math.hypot(
      Math.max(box.left - point.x, 0, point.x - box.right),
      Math.max(box.top - point.y, 0, point.y - box.bottom),
    );
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = { entry, after: point.y > box.bottom || (point.y >= box.top && pastCentre(box, point)) };
  }
  return best;
}

/**
 * Where `entry` should go so it lands beside `target`, as the `before` argument of a move.
 * Undefined when that is where it already is.
 */
export function slotBefore(
  siblings: readonly LibraryEntry[],
  entry: LibraryEntry,
  target: LibraryEntry,
  after: boolean,
): { before: LibraryEntry | null } | undefined {
  const rest = siblings.filter((id) => id !== entry);
  const targetIndex = rest.indexOf(target);
  if (targetIndex < 0) return undefined;
  const at = targetIndex + (after ? 1 : 0);
  // Already there: nothing to write.
  if (siblings.indexOf(entry) === at && rest.length === siblings.length - 1) return undefined;
  return { before: rest[at] ?? null };
}

/** Autoscroll speed for a pointer near a scroller's top or bottom edge; 0 outside the bands. */
export function edgeScroll(top: number, bottom: number, y: number) {
  if (y < top + SCROLL_EDGE) return -Math.min(SCROLL_MAX_STEP, (top + SCROLL_EDGE - y) / 4);
  if (y > bottom - SCROLL_EDGE) return Math.min(SCROLL_MAX_STEP, (y - bottom + SCROLL_EDGE) / 4);
  return 0;
}

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
export const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Holding on one key for `ms` makes it ready. Holding the same key again keeps the
 * original timer; a different key restarts it.
 */
export function createDwell<T>(ms: number, onReady: (key: T) => void, timers: Timers = realTimers) {
  let key: T | undefined;
  let handle: unknown;
  let ready = false;
  const clear = () => {
    if (handle !== undefined) timers.clear(handle);
    handle = undefined;
    key = undefined;
    ready = false;
  };
  return {
    hold(next: T) {
      if (key === next) return;
      clear();
      key = next;
      handle = timers.set(() => {
        handle = undefined;
        ready = true;
        onReady(next);
      }, ms);
    },
    clear,
    pending: () => key,
    ready: () => (ready ? key : undefined),
  };
}

/** The keys that move an entry while moving with the keyboard. */
export const keyboardMoveKeys = new Set(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End']);

/** Index an entry moves to for a key, clamped to the list. Undefined for other keys. */
export function keyboardTarget(index: number, count: number, key: string) {
  if (count === 0 || !keyboardMoveKeys.has(key)) return undefined;
  const next = key === 'Home' ? 0
    : key === 'End' ? count - 1
    : key === 'ArrowLeft' || key === 'ArrowUp' ? index - 1
    : index + 1;
  return Math.max(0, Math.min(count - 1, next));
}

/** The `before` entry that puts `entry` at `index` among its siblings. */
export function beforeForIndex(siblings: readonly LibraryEntry[], entry: LibraryEntry, index: number) {
  const rest = siblings.filter((id) => id !== entry);
  return rest[index] ?? null;
}
