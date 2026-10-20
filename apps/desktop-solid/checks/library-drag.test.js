import { afterEach, expect, test } from 'bun:test';
import { createLibraryDrag } from '../src/features/instances/library-drag';
import { createLibraryLayoutStore } from '../src/features/instances/library-layout';
let restore = () => {};
afterEach(() => restore());
async function harness(group = true) {
  const originals = new Map();
  const replace = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let controller;
  restore = () => {
    controller?.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
  const events = () => ({
    listeners: new Map(),
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); },
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); },
    emit(type, event = {}) { for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type, ...event }); },
    count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  });
  const element = (entry, left = 0) => ({
    ...events(), dataset: { libraryItem: entry }, style: { setProperty() {} }, captures: new Set(),
    setPointerCapture(id) { this.captures.add(id); }, hasPointerCapture(id) { return this.captures.has(id); },
    releasePointerCapture(id) { this.captures.delete(id); this.emit('lostpointercapture', { pointerId: id }); },
    getBoundingClientRect: () => ({ left, right: left + 100, top: 100, bottom: 200, width: 100, height: 100 }),
    cloneNode: () => element(entry, left), removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], append() {}, remove() {},
  });
  const a = element('a');
  const nodes = [a, element(group ? 'group:g' : 'b', 120), element('c', 240)];
  const surface = {
    dataset: { librarySurface: 'main' }, scrollTop: 0, scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 0, right: 500, top: 0, bottom: 500 }),
    querySelectorAll: () => nodes, closest() { return this; },
  };
  for (const node of nodes) node.parentElement = { closest: () => surface };
  const win = events();
  replace('window', win);
  replace('document', {
    documentElement: { hasAttribute: () => true }, body: { append() {} }, createElement: () => element(''),
    querySelector: () => null, querySelectorAll: (selector) => selector === '[data-library-surface]' ? [surface] : nodes,
  });
  let sequence = 0, now = 0;
  const frames = new Map(), timers = new Map();
  replace('requestAnimationFrame', (fn) => { frames.set(++sequence, fn); return sequence; });
  replace('cancelAnimationFrame', (id) => frames.delete(id));
  replace('setTimeout', (fn, ms) => { timers.set(++sequence, { fn, at: now + ms }); return sequence; });
  replace('clearTimeout', (id) => timers.delete(id));
  const frame = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); };
  const advance = (ms) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } };
  const writes = [];
  const initial = { version: 1, sort: 'custom', order: ['a', group ? 'group:g' : 'b', 'c'], groups: group ? [{ id: 'group:g', name: 'G', color: 205, instances: ['b'] }] : [] };
  const store = createLibraryLayoutStore({ load: async () => JSON.stringify(initial), save: async (value) => writes.push(JSON.parse(value)) });
  await store.load();
  controller = createLibraryDrag({ store, instanceIds: () => ['a', 'b', 'c'], openGroup: () => null, setOpenGroup() {}, announce() {},
    messages: { groupCreated: () => 'grouped', moved: () => 'moved', movedOut: () => 'out', cancelled: () => 'cancelled', newGroupName: () => 'New' } });
  const event = (x, y = 150) => ({ pointerId: 1, clientX: x, clientY: y });
  return { controller, store, writes, initial, a, win, frames, timers, frame, advance,
    down: () => controller.pointerDown({ ...event(50), currentTarget: a, button: 0, preventDefault() {} }, 'a'),
    move: (x, y) => a.emit('pointermove', event(x, y)), up: (x, y) => a.emit('pointerup', event(x, y)) };
}
for (const reason of ['Escape', 'blur', 'pointercancel', 'lostpointercapture', 'dispose', 'cancel']) {
  test(`${reason} clears capture/listeners and cannot restart on held-pointer movement`, async () => {
    const h = await harness(); h.down(); h.move(170); h.frame();
    expect(h.controller.dragging()).toBe('a');
    if (reason === 'Escape') h.win.emit('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
    else if (reason === 'blur') h.win.emit('blur');
    else if (reason === 'pointercancel') h.a.emit('pointercancel', { pointerId: 1 });
    else if (reason === 'lostpointercapture') h.a.releasePointerCapture(1);
    else h.controller[reason]();
    expect(h.controller.dragging()).toBeNull(); expect(h.a.captures.size).toBe(0);
    expect(h.a.count()).toBe(0); expect(h.win.count()).toBe(0);
    expect(h.frames.size).toBe(0); expect(h.timers.size).toBe(0);
    h.move(300); h.up(300); h.frame(); expect(h.controller.dragging()).toBeNull();
    expect(h.store.layout()).toEqual(h.initial); await h.store.flush(); expect(h.writes).toEqual([]);
    h.down(); h.move(170); expect(h.controller.dragging()).toBe('a');
  });
}
test('cancelling before the threshold cleans the press', async () => {
  const h = await harness(); h.down(); h.controller.cancel();
  expect(h.a.captures.size).toBe(0); expect(h.a.count()).toBe(0); h.move(170); expect(h.controller.dragging()).toBeNull();
});
test('release outside a folder clears stale target and processes final reorder before rAF', async () => {
  const h = await harness(); h.down(); h.move(170); h.frame(); expect(h.controller.folderTarget()).toBe('group:g');
  h.move(330); h.up(330); await h.store.flush();
  expect(h.store.layout().groups[0].instances).toEqual(['b']);
  expect(h.store.layout().order).toEqual(['group:g', 'c', 'a']); expect(h.writes).toHaveLength(1); expect(h.frames.size).toBe(0);
});
test('pointerup coordinates alone can enter an existing folder', async () => {
  const h = await harness(); h.down(); h.move(60); h.frame(); h.up(170); await h.store.flush();
  expect(h.store.layout().groups[0].instances).toEqual(['b', 'a']); expect(h.writes).toHaveLength(1);
});
test('completed dwell cannot group with stale target on release over another card', async () => {
  const h = await harness(false); h.down(); h.move(170); h.frame(); h.advance(160); expect(h.controller.groupTarget()).toBe('b');
  h.move(290); h.up(290); await h.store.flush();
  expect(h.store.layout().groups).toEqual([]); expect(h.writes).toEqual([]); expect(h.timers.size).toBe(0);
});
test('same middle preserves completed dwell', async () => {
  const h = await harness(false); h.down(); h.move(170); h.frame(); h.advance(160); h.up(170); await h.store.flush();
  expect(h.store.layout().groups[0].instances).toEqual(['b', 'a']); expect(h.writes).toHaveLength(1);
});
test('release cannot complete unfinished dwell', async () => {
  const h = await harness(false); h.down(); h.move(170); h.frame(); h.advance(159); h.up(170); h.advance(1000); await h.store.flush();
  expect(h.store.layout().groups).toEqual([]); expect(h.writes).toEqual([]);
});
test('Escape restores a live reorder and cancels its settle timer and scrolling frame', async () => {
  const h = await harness(false); h.down(); h.move(330); h.frame();
  expect(h.store.layout().order).toEqual(['b', 'c', 'a']); expect(h.timers.size).toBeGreaterThan(0);
  h.move(330, 490); h.frame(); expect(h.frames.size).toBeGreaterThan(0);
  h.win.emit('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  expect(h.store.layout()).toEqual(h.initial); expect(h.frames.size).toBe(0); expect(h.timers.size).toBe(0);
  h.advance(1000); h.frame(); await h.store.flush(); expect(h.writes).toEqual([]);
});
test('release outside the surface cannot use a stale folder target', async () => {
  const h = await harness(); h.down(); h.move(170); h.frame(); h.up(700, 700);
  await h.store.flush(); expect(h.store.layout()).toEqual(h.initial); expect(h.writes).toEqual([]);
});
