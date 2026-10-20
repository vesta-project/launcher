import { describe, expect, test } from "bun:test";
import {
  GROUP_DWELL_MS,
  SETTLE_MS,
  FLIP_MS,
  createDwell,
  edgeScroll,
  inMiddle,
  itemAt,
  keyboardTarget,
  nearestSlot,
  slotBefore,
} from "../src/features/instances/library-arrange";
import { createKeyboardMove } from "../src/features/instances/library-drag";
import { createLibraryLayoutStore, customOrder } from "../src/features/instances/library-layout";

/** Manual clock for dwell timers. */
function clock() {
  let now = 0;
  const pending = new Map();
  let next = 0;
  return {
    timers: {
      set: (callback, ms) => { pending.set(++next, { at: now + ms, callback }); return next; },
      clear: (handle) => pending.delete(handle),
    },
    advance(ms) {
      now += ms;
      for (const [handle, timer] of [...pending]) {
        if (timer.at <= now) { pending.delete(handle); timer.callback(); }
      }
    },
  };
}

const box = (left, top, size = 100) => ({ left, top, right: left + size, bottom: top + size });

describe("tuned timings carried over from the old organizer", () => {
  test("grouping dwell, settle and reorder animation", () => {
    expect(GROUP_DWELL_MS).toBe(160);
    expect(SETTLE_MS).toBe(240);
    expect(FLIP_MS).toBe(260);
  });
});

describe("slot maths", () => {
  test("the middle half groups and the edges reorder", () => {
    const card = box(0, 0);
    expect(inMiddle(card, { x: 50, y: 50 })).toBe(true);
    expect(inMiddle(card, { x: 25, y: 25 })).toBe(true);
    expect(inMiddle(card, { x: 10, y: 50 })).toBe(false);
    expect(inMiddle(card, { x: 50, y: 90 })).toBe(false);
  });

  test("hit testing skips the carried item", () => {
    const items = [{ entry: "a", box: box(0, 0) }, { entry: "b", box: box(120, 0) }];
    expect(itemAt(items, { x: 150, y: 50 })?.entry).toBe("b");
    expect(itemAt(items, { x: 50, y: 50 }, "a")).toBeUndefined();
    expect(itemAt(items, { x: 110, y: 50 })).toBeUndefined();
  });

  test("a gap lands beside the nearest card, after it when right of centre or below", () => {
    const items = [{ entry: "a", box: box(0, 0) }, { entry: "b", box: box(120, 0) }, { entry: "c", box: box(0, 120) }];
    expect(nearestSlot(items, { x: 112, y: 50 }, "x")).toEqual({ entry: "b", after: false });
    expect(nearestSlot(items, { x: 50, y: 230 }, "x")).toEqual({ entry: "c", after: true });
    expect(nearestSlot(items, { x: 80, y: 105 }, "x")).toEqual({ entry: "a", after: true });
  });

  test("slotBefore names the next sibling, or nothing when already in place", () => {
    const list = ["a", "b", "c", "d"];
    expect(slotBefore(list, "a", "c", true)).toEqual({ before: "d" });
    expect(slotBefore(list, "a", "d", true)).toEqual({ before: null });
    expect(slotBefore(list, "d", "a", false)).toEqual({ before: "a" });
    expect(slotBefore(list, "b", "a", true)).toBeUndefined();
    expect(slotBefore(list, "b", "c", false)).toBeUndefined();
    expect(slotBefore(list, "b", "missing", false)).toBeUndefined();
  });

  test("autoscroll only inside the 60px edge bands, at most 14px a frame", () => {
    expect(edgeScroll(0, 600, 300)).toBe(0);
    expect(edgeScroll(0, 600, 50)).toBeLessThan(0);
    expect(edgeScroll(0, 600, -400)).toBe(-14);
    expect(edgeScroll(0, 600, 590)).toBeGreaterThan(0);
    expect(edgeScroll(0, 600, 2000)).toBe(14);
  });
});

describe("grouping dwell", () => {
  test("holding the same card keeps one timer; a different card restarts it", () => {
    const time = clock();
    const ready = [];
    const dwell = createDwell(GROUP_DWELL_MS, (key) => ready.push(key), time.timers);
    dwell.hold("a");
    time.advance(100);
    dwell.hold("a");
    time.advance(60);
    expect(ready).toEqual(["a"]);
    dwell.hold("b");
    time.advance(100);
    dwell.hold("c");
    time.advance(100);
    expect(ready).toEqual(["a"]);
    time.advance(60);
    expect(ready).toEqual(["a", "c"]);
  });

  test("clearing before the dwell ends never fires", () => {
    const time = clock();
    const ready = [];
    const dwell = createDwell(GROUP_DWELL_MS, (key) => ready.push(key), time.timers);
    dwell.hold("a");
    time.advance(159);
    dwell.clear();
    time.advance(500);
    expect(ready).toEqual([]);
  });
});

describe("keyboard move", () => {
  test("keys clamp to the list", () => {
    expect(keyboardTarget(0, 4, "ArrowLeft")).toBe(0);
    expect(keyboardTarget(0, 4, "ArrowUp")).toBe(0);
    expect(keyboardTarget(3, 4, "ArrowRight")).toBe(3);
    expect(keyboardTarget(1, 4, "ArrowDown")).toBe(2);
    expect(keyboardTarget(2, 4, "Home")).toBe(0);
    expect(keyboardTarget(0, 4, "End")).toBe(3);
    expect(keyboardTarget(0, 4, "a")).toBeUndefined();
  });

  async function moveHarness() {
    const writes = [];
    const store = createLibraryLayoutStore({
      load: async () => JSON.stringify({ version: 1, sort: "custom", order: [1, 2, 3, 4], groups: [] }),
      save: async (document) => { writes.push(JSON.parse(document).order); },
    });
    await store.load();
    const ids = ["1", "2", "3", "4"];
    const steps = [];
    const move = createKeyboardMove({ store, instanceIds: () => ids, onStep: (_entry, position, count) => steps.push([position, count]) });
    return { store, writes, ids, move, steps };
  }

  test("steps preview without saving, and Enter saves once", async () => {
    const { store, writes, ids, move, steps } = await moveHarness();
    move.start("2");
    expect(move.key("ArrowRight")).toBe(true);
    expect(move.key("End")).toBe(true);
    expect(move.key("ArrowRight")).toBe(true);
    expect(customOrder(store.layout(), ids)).toEqual(["1", "3", "4", "2"]);
    expect(steps).toEqual([[3, 4], [4, 4], [4, 4]]);
    expect(move.key("x")).toBe(false);
    await store.flush();
    expect(writes).toEqual([]);
    expect(move.key("Enter")).toBe(true);
    expect(move.active()).toBeUndefined();
    await store.flush();
    expect(writes).toEqual([[1, 3, 4, 2]]);
  });

  test("Escape puts everything back without saving", async () => {
    const { store, writes, ids, move } = await moveHarness();
    move.start("4");
    move.key("Home");
    expect(customOrder(store.layout(), ids)).toEqual(["4", "1", "2", "3"]);
    move.key("Escape");
    expect(customOrder(store.layout(), ids)).toEqual(["1", "2", "3", "4"]);
    await store.flush();
    expect(writes).toEqual([]);
  });
});
