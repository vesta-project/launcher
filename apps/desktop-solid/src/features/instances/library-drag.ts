import { createSignal, flush } from 'solid-js';
import {
  CARRY_SCALE, CLICK_SUPPRESS_MS, DRAG_THRESHOLD, FLIP_EASING, FLIP_MS, GROUP_DWELL_MS, GROUP_SCALE, SETTLE_MS,
  beforeForIndex, createDwell, edgeScroll, inMiddle, itemAt, keyboardMoveKeys, keyboardTarget, nearestSlot,
  pastCentre, slotBefore, within, type Box, type MeasuredItem, type Point,
} from './library-arrange';
import {
  containerOf, createGroup, customOrder, isGroupEntry, moveEntry,
  type LibraryEntry, type LibraryLayout, type LibraryLayoutStore,
} from './library-layout';

/*
 * Pointer arranging for the library, replacing the old launcher's solid-dnd organizer.
 *
 * DOM contract (set by the library page and folder popup):
 *   [data-library-item="<entry>"]       a card or group tile that can be carried
 *   [data-library-surface="main"]       the top-level grid
 *   [data-library-surface="<group id>"] the grid inside an open group (its own scroller)
 *   [data-folder-popup="<group id>"]    the open group's dialog, for its bounds
 *
 * Cost per drag: rectangles are measured when the drag starts and again only after a live
 * reorder has settled; pointer moves are coalesced into one animation frame; signals are
 * written only when the target changes; the layout is saved once, on release.
 */

const reducedMotion = () =>
  document.documentElement.hasAttribute('data-vesta-reduced-motion')
  || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

interface Surface {
  /** null for the top-level grid, otherwise the group id. */
  id: string | null;
  items: MeasuredItem[];
  scroller: HTMLElement | null;
  scrollTop: number;
  scrollLeft: number;
  /** Visible bounds of the scroller (or the popup), for gaps and autoscroll. */
  bounds: Box;
}

export interface LibraryDragMessages {
  groupCreated: () => string;
  moved: (entry: LibraryEntry) => string;
  movedOut: (entry: LibraryEntry) => string;
  cancelled: () => string;
  newGroupName: () => string;
}

export interface LibraryDragOptions {
  store: LibraryLayoutStore;
  instanceIds: () => readonly string[];
  openGroup: () => string | null;
  setOpenGroup: (id: string | null) => void;
  announce: (message: string) => void;
  messages: LibraryDragMessages;
}

const surfaceKey = (id: string | null) => id ?? 'main';
const boxOf = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

/** Replays the move of every item in a surface from where it was to where it is now. */
export function flipItems(surface: string | null, action: () => void) {
  if (reducedMotion()) {
    action();
    return;
  }
  const selector = `[data-library-surface="${surfaceKey(surface)}"] [data-library-item]`;
  const before = new Map<string, DOMRect>();
  for (const node of document.querySelectorAll<HTMLElement>(selector)) {
    before.set(node.dataset.libraryItem!, node.getBoundingClientRect());
  }
  action();
  flush();
  for (const node of document.querySelectorAll<HTMLElement>(selector)) {
    const previous = before.get(node.dataset.libraryItem!);
    if (!previous) continue;
    const current = node.getBoundingClientRect();
    const dx = previous.left - current.left;
    const dy = previous.top - current.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) continue;
    node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: FLIP_EASING });
  }
}

export function createLibraryDrag(options: LibraryDragOptions) {
  const { store } = options;
  const [dragging, setDragging] = createSignal<LibraryEntry | null>(null, { name: 'libraryDragging' });
  const [groupPending, setGroupPending] = createSignal<LibraryEntry | null>(null, { name: 'libraryGroupPending' });
  const [groupTarget, setGroupTarget] = createSignal<LibraryEntry | null>(null, { name: 'libraryGroupTarget' });
  const [folderTarget, setFolderTarget] = createSignal<string | null>(null, { name: 'libraryFolderTarget' });
  const dwell = createDwell<LibraryEntry>(GROUP_DWELL_MS, (entry) => setGroupTarget(entry));

  let press: { entry: LibraryEntry; node: HTMLElement; pointerId: number; origin: Point } | undefined;
  let drag: {
    entry: LibraryEntry;
    node: HTMLElement;
    container: string | null;
    snapshot: LibraryLayout;
    offset: Point;
    ownBox: Box;
    surfaces: Map<string, Surface>;
    popup: { id: string; box: Box } | undefined;
    ghost: HTMLElement;
    body: HTMLElement;
  } | undefined;
  let point: Point = { x: 0, y: 0 };
  let moved = false;
  let frame = 0;
  let settling = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressUntil = 0;
  // Sway state: the preview hangs from the grabbed point and swings with horizontal speed.
  let last: Point = { x: 0, y: 0 };
  let tilt = 0;
  let lift = 0;
  let scale = 1;

  const clearIntent = () => {
    dwell.clear();
    setGroupPending(null);
    setGroupTarget(null);
    setFolderTarget(null);
  };

  const measure = () => {
    if (!drag) return;
    const surfaces = new Map<string, Surface>();
    for (const element of document.querySelectorAll<HTMLElement>('[data-library-surface]')) {
      const key = element.dataset.librarySurface!;
      const id = key === 'main' ? null : key;
      const scroller = id === null ? element.closest<HTMLElement>('[data-vesta="board"]') : element;
      const items: MeasuredItem[] = [];
      for (const node of element.querySelectorAll<HTMLElement>('[data-library-item]')) {
        // Items inside a nested surface belong to that one.
        if (node.parentElement?.closest('[data-library-surface]') !== element) continue;
        items.push({ entry: node.dataset.libraryItem!, box: boxOf(node.getBoundingClientRect()) });
      }
      surfaces.set(key, {
        id, items, scroller,
        scrollTop: scroller?.scrollTop ?? 0,
        scrollLeft: scroller?.scrollLeft ?? 0,
        bounds: boxOf((scroller ?? element).getBoundingClientRect()),
      });
    }
    const popupElement = document.querySelector<HTMLElement>('[data-folder-popup]');
    const popupDialog = popupElement?.closest<HTMLElement>('[data-vesta="dialog"]') ?? popupElement;
    drag.popup = popupElement && popupDialog
      ? { id: popupElement.dataset.folderPopup!, box: boxOf(popupDialog.getBoundingClientRect()) }
      : undefined;
    drag.surfaces = surfaces;
    const own = [...surfaces.values()].flatMap((surface) => surface.items).find((item) => item.entry === drag!.entry);
    if (own) drag.ownBox = own.box;
  };

  /** The pointer in the coordinates the surface was measured in. */
  const local = (surface: Surface): Point => ({
    x: point.x + ((surface.scroller?.scrollLeft ?? 0) - surface.scrollLeft),
    y: point.y + ((surface.scroller?.scrollTop ?? 0) - surface.scrollTop),
  });

  const surfaceAtPoint = (): Surface | undefined => {
    if (!drag) return undefined;
    if (drag.popup && within(drag.popup.box, point)) return drag.surfaces.get(drag.popup.id);
    return drag.surfaces.get('main');
  };

  const siblingsOf = (layout: LibraryLayout, container: string | null): LibraryEntry[] => (container === null
    ? customOrder(layout, options.instanceIds())
    : layout.groups.find((group) => group.id === container)?.instances ?? []);

  const settle = () => {
    settling = true;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settling = false;
      measure();
      schedule();
    }, reducedMotion() ? 60 : SETTLE_MS);
  };

  const reorderLive = (target: LibraryEntry, after: boolean) => {
    if (!drag) return;
    const layout = store.layout();
    const slot = slotBefore(siblingsOf(layout, drag.container), drag.entry, target, after);
    if (!slot) return;
    const entry = drag.entry;
    const container = drag.container;
    settle();
    flipItems(container, () => store.preview(moveEntry(layout, options.instanceIds(), entry, container, slot.before)));
  };

  /** Like a phone's home screen: edges reorder now, holding on the middle groups. */
  const updateIntent = () => {
    if (!drag || settling) {
      if (!drag) clearIntent();
      return;
    }
    const surface = surfaceAtPoint();
    if (!surface || surface.id !== drag.container) {
      // Crossing into or out of a group is resolved on release.
      clearIntent();
      return;
    }
    const at = local(surface);
    const hit = itemAt(surface.items, at, drag.entry);
    if (!hit) {
      clearIntent();
      if (within(drag.ownBox, at) || !within(surface.bounds, point)) return;
      const slot = nearestSlot(surface.items, at, drag.entry);
      if (slot) reorderLive(slot.entry, slot.after);
      return;
    }
    const groupsHere = !isGroupEntry(drag.entry) && drag.container === null;
    if (groupsHere && inMiddle(hit.box, at)) {
      if (isGroupEntry(hit.entry)) {
        // An existing group takes the card straight away; only cards dwell.
        if (folderTarget() === hit.entry) return;
        clearIntent();
        setFolderTarget(hit.entry);
        return;
      }
      if (dwell.pending() === hit.entry) return;
      clearIntent();
      setGroupPending(hit.entry);
      dwell.hold(hit.entry);
      return;
    }
    clearIntent();
    reorderLive(hit.entry, pastCentre(hit.box, at));
  };

  const autoscroll = () => {
    const surface = surfaceAtPoint();
    const scroller = surface?.scroller;
    if (!surface || !scroller) return false;
    const box = surface.bounds;
    if (point.x < box.left || point.x > box.right) return false;
    const step = edgeScroll(box.top, box.bottom, point.y);
    if (!step) return false;
    const before = scroller.scrollTop;
    scroller.scrollTop += step;
    return scroller.scrollTop !== before;
  };

  const sway = () => {
    if (!drag) return false;
    const vx = point.x - last.x;
    const speed = Math.hypot(vx, point.y - last.y);
    last = { ...point };
    const rest = groupPending() !== null || folderTarget() !== null ? GROUP_SCALE : CARRY_SCALE;
    let moving = false;
    if (reducedMotion()) {
      scale = rest;
      tilt = 0;
      lift = 0;
    } else {
      const nextTilt = tilt + (Math.max(-14, Math.min(14, vx * 0.5)) - tilt) * 0.18;
      const nextLift = lift + (Math.min(0.05, speed * 0.002) - lift) * 0.18;
      const nextScale = scale + (rest - scale) * 0.22;
      moving = Math.abs(nextTilt - tilt) > 0.01 || Math.abs(nextLift - lift) > 0.0005 || Math.abs(nextScale - scale) > 0.001
        || Math.abs(nextTilt) > 0.05;
      tilt = nextTilt;
      lift = nextLift;
      scale = nextScale;
    }
    drag.ghost.style.transform = `translate3d(${point.x - drag.offset.x}px, ${point.y - drag.offset.y}px, 0)`;
    drag.body.style.setProperty('--library-ghost-tilt', `${1.2 + tilt}deg`);
    drag.body.style.setProperty('--library-ghost-scale', `${scale + lift}`);
    return moving;
  };

  // One frame does everything; it keeps running only while something is still moving.
  const tick = () => {
    frame = 0;
    if (!drag) return;
    let again = false;
    if (autoscroll()) {
      again = true;
      moved = true;
    }
    if (moved) {
      moved = false;
      updateIntent();
    }
    if (sway()) again = true;
    if (again) schedule();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const begin = () => {
    if (!press) return;
    const { entry, node, origin } = press;
    const rect = node.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.dataset.vesta = 'library-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.style.inlineSize = `${rect.width}px`;
    ghost.style.blockSize = `${rect.height}px`;
    const body = document.createElement('div');
    body.dataset.vesta = 'library-ghost-body';
    body.style.setProperty('--library-ghost-origin', `${origin.x - rect.left}px ${origin.y - rect.top}px`);
    const clone = node.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-library-item');
    clone.removeAttribute('data-dragging');
    for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id');
    for (const element of clone.querySelectorAll('[data-library-control]')) element.remove();
    body.append(clone);
    ghost.append(body);
    document.body.append(ghost);
    drag = {
      entry, node,
      container: containerOf(store.layout(), entry),
      snapshot: store.layout(),
      offset: { x: origin.x - rect.left, y: origin.y - rect.top },
      ownBox: boxOf(rect),
      surfaces: new Map(),
      popup: undefined,
      ghost, body,
    };
    scale = 1;
    tilt = 0;
    lift = 0;
    last = { ...point };
    measure();
    setDragging(entry);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);
    moved = true;
    schedule();
  };

  // Clear ownership before releasing capture: lostpointercapture may dispatch synchronously.
  const clearPress = () => {
    const held = press;
    press = undefined;
    if (!held) return;
    const { node, pointerId } = held;
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', release);
    node.removeEventListener('pointercancel', release);
    node.removeEventListener('lostpointercapture', cancel);
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
  };

  const finish = () => {
    clearPress();
    moved = false;
    clearTimeout(settleTimer);
    settling = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    drag?.ghost.remove();
    drag = undefined;
    clearIntent();
    setDragging(null);
    suppressUntil = performance.now() + CLICK_SUPPRESS_MS;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', cancel);
  };

  /** Release: resolve groups and crossings, then save once. */
  const drop = () => {
    if (!drag) return;
    // Pointerup can arrive before the queued move frame. Resolve the release geometry
    // now, retaining a completed dwell only if it still hits the same card's middle.
    if (settling) {
      clearTimeout(settleTimer);
      settling = false;
      measure();
    }
    updateIntent();
    const { entry, container, snapshot } = drag;
    const ids = options.instanceIds();
    const target = groupTarget();
    const folder = folderTarget();
    const surface = surfaceAtPoint();
    let layout = store.layout();
    let message = '';
    let openAfter: string | null | undefined;
    if (target !== null && !isGroupEntry(entry)) {
      const id = `group:${crypto.randomUUID()}`;
      layout = createGroup(layout, ids, [target, entry], id, options.messages.newGroupName());
      openAfter = id;
      message = options.messages.groupCreated();
    } else if (folder !== null && !isGroupEntry(entry)) {
      layout = moveEntry(layout, ids, entry, folder, null);
      message = options.messages.moved(entry);
    } else if (surface && surface.id !== container && !isGroupEntry(entry)) {
      const at = local(surface);
      if (surface.id === null) {
        // Out of a group: land in the nearest slot of the top level.
        const slot = nearestSlot(surface.items, at, entry);
        const order = customOrder(layout, ids);
        const before = slot ? order[order.indexOf(slot.entry) + (slot.after ? 1 : 0)] ?? null : null;
        layout = moveEntry(layout, ids, entry, null, before);
        message = options.messages.movedOut(entry);
      } else {
        // Into the open group, beside whatever it was released on.
        const hit = itemAt(surface.items, at, entry);
        const members = layout.groups.find((group) => group.id === surface.id)?.instances ?? [];
        const before = hit ? (pastCentre(hit.box, at) ? members[members.indexOf(hit.entry) + 1] ?? null : hit.entry) : null;
        layout = moveEntry(layout, ids, entry, surface.id, before);
        message = options.messages.moved(entry);
      }
    } else if (layout !== snapshot) {
      message = options.messages.moved(entry);
    }
    const live = store.layout();
    finish();
    if (layout !== live) flipItems(null, () => store.preview(layout));
    if (layout !== snapshot) store.commit(layout);
    if (openAfter !== undefined) options.setOpenGroup(openAfter);
    if (message) options.announce(message);
  };

  /** Escape, pointer cancel or the window losing focus: put everything back. */
  const cancel = () => {
    if (!drag) {
      finish();
      return;
    }
    const snapshot = drag.snapshot;
    const container = drag.container;
    finish();
    flipItems(container, () => store.preview(snapshot));
    options.announce(options.messages.cancelled());
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !drag) return;
    // Captured first so an open group's dialog does not also close.
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };

  const onMove = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    point = { x: event.clientX, y: event.clientY };
    if (!drag) {
      if (Math.hypot(point.x - press.origin.x, point.y - press.origin.y) < DRAG_THRESHOLD) return;
      begin();
      return;
    }
    moved = true;
    schedule();
  };

  const release = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    clearPress();
    if (!drag) return;
    point = { x: event.clientX, y: event.clientY };
    if (event.type === 'pointercancel') cancel();
    else drop();
  };

  return {
    dragging,
    groupPending,
    groupTarget,
    folderTarget,
    /** Clicks right after a drag are the drop landing, not a request to open. */
    suppressClick: () => performance.now() < suppressUntil,
    /** Wire to pointerdown on a carried item while arranging. */
    pointerDown(event: PointerEvent, entry: LibraryEntry) {
      if (event.button !== 0 || press || drag) return;
      const node = event.currentTarget as HTMLElement;
      event.preventDefault();
      press = { entry, node, pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY } };
      point = { ...press.origin };
      node.setPointerCapture(event.pointerId);
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', release);
      node.addEventListener('pointercancel', release);
      node.addEventListener('lostpointercapture', cancel);
    },
    cancel,
    dispose() {
      cancel();
      dwell.clear();
    },
  };
}

export type LibraryDrag = ReturnType<typeof createLibraryDrag>;

export interface KeyboardMoveOptions {
  store: LibraryLayoutStore;
  instanceIds: () => readonly string[];
  /** Called after each step, with the entry's new position (1-based) and sibling count. */
  onStep?: (entry: LibraryEntry, position: number, count: number) => void;
}

/**
 * Moving one entry with the keyboard: arrows step, Home/End jump, Enter keeps the new place,
 * Escape puts it back. Steps are shown without saving; Enter saves once.
 */
export function createKeyboardMove(options: KeyboardMoveOptions) {
  let active: { entry: LibraryEntry; container: string | null; snapshot: LibraryLayout } | undefined;
  const siblings = (layout: LibraryLayout, container: string | null) => (container === null
    ? customOrder(layout, options.instanceIds())
    : layout.groups.find((group) => group.id === container)?.instances ?? []);
  const move = {
    active: () => active?.entry,
    start(entry: LibraryEntry) {
      const layout = options.store.layout();
      active = { entry, container: containerOf(layout, entry), snapshot: layout };
    },
    /** Handles one key. True when it was a move key and the event should go no further. */
    key(key: string, apply: (change: () => void) => void = (change) => change()) {
      if (!active) return false;
      if (key === 'Enter') {
        move.commit();
        return true;
      }
      if (key === 'Escape') {
        move.cancel(apply);
        return true;
      }
      if (!keyboardMoveKeys.has(key)) return false;
      const { entry, container } = active;
      const layout = options.store.layout();
      const list = siblings(layout, container);
      const index = list.indexOf(entry);
      const next = keyboardTarget(index, list.length, key);
      if (next === undefined || index < 0) return true;
      if (next !== index) {
        apply(() => options.store.preview(moveEntry(layout, options.instanceIds(), entry, container, beforeForIndex(list, entry, next))));
      }
      options.onStep?.(entry, next + 1, list.length);
      return true;
    },
    commit() {
      if (!active) return;
      const changed = options.store.layout() !== active.snapshot;
      active = undefined;
      if (changed) options.store.commit();
    },
    cancel(apply: (change: () => void) => void = (change) => change()) {
      if (!active) return;
      const snapshot = active.snapshot;
      active = undefined;
      apply(() => options.store.preview(snapshot));
    },
  };
  return move;
}
