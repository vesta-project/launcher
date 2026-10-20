/**
 * Group hover tests, ported from the old launcher's file-drag-groups.test.ts. A fake
 * controller feeds hand-built hit lists, so they check the open/close rules only. They are
 * NOT proof of native OS drag behaviour.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  FILE_DRAG_GROUP_DWELL_MS,
  watchFileDragOverGroups,
} from "../src/features/instances/library-file-drag";

/** Just enough of an element for closest() on the two data attributes the watcher reads. */
function element(dataset = {}, parentElement = null) {
  return {
    dataset,
    parentElement,
    closest(selector) {
      const key = selector === "[data-folder-popup]" ? "folderPopup" : "folderTile";
      for (let node = this; node; node = node.parentElement) if (node.dataset[key] !== undefined) return node;
      return null;
    },
  };
}
const tile = (id) => element({}, element({ folderTile: id }));
const popup = (id) => element({}, element({ folderPopup: id }));
const backdrop = () => element();

let time;
function clock() {
  let now = 0;
  let next = 0;
  const pending = new Map();
  return {
    timers: {
      set: (callback, ms) => { pending.set(++next, { at: now + ms, callback }); return next; },
      clear: (handle) => { pending.delete(handle); },
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = until;
    },
  };
}

function harness(overrides = {}) {
  let observer;
  let open = null;
  const hovered = [];
  const dropsOnClosed = [];
  const stop = watchFileDragOverGroups({
    controller: {
      observe: (next) => {
        observer = next;
        return () => { observer = undefined; };
      },
    },
    getOpenGroup: () => open,
    setOpenGroup: (id) => { open = id; },
    isEnabled: () => true,
    onHoverGroup: (id) => hovered.push(id),
    onDropOnClosedGroup: (id) => dropsOnClosed.push(id),
    timers: time.timers,
    ...overrides,
  });
  const emit = (observation) => observer?.(observation);
  return {
    stop,
    hovered,
    dropsOnClosed,
    get open() { return open; },
    set open(value) { open = value; },
    get watching() { return observer !== undefined; },
    move: (...hits) => emit({ type: "move", point: null, hits }),
    drop: (...hits) => emit({ type: "drop", point: null, hits }),
    end: () => emit({ type: "end", point: null, hits: [] }),
  };
}

beforeEach(() => {
  time = clock();
});

describe("opening a group", () => {
  test("opens a group after the pointer dwells on its tile", () => {
    const h = harness();
    h.move(tile("g1"));
    expect(h.open).toBeNull();
    expect(h.hovered).toEqual(["g1"]);

    time.advance(FILE_DRAG_GROUP_DWELL_MS);
    expect(h.open).toBe("g1");
    expect(h.hovered).toEqual(["g1", null]);
  });

  test("keeps one timer while the pointer moves within the same tile", () => {
    const h = harness();
    const button = tile("g1");
    h.move(button);
    time.advance(FILE_DRAG_GROUP_DWELL_MS - 50);
    h.move(button);
    time.advance(50);
    expect(h.open).toBe("g1");
  });

  test("does not open when the pointer leaves the tile before the dwell ends", () => {
    const h = harness();
    h.move(tile("g1"));
    time.advance(FILE_DRAG_GROUP_DWELL_MS - 1);
    h.move(backdrop());
    time.advance(1000);
    expect(h.open).toBeNull();
    expect(h.hovered).toEqual(["g1", null]);
  });

  test("restarts the dwell when the pointer moves to a different tile", () => {
    const h = harness();
    h.move(tile("g1"));
    time.advance(300);
    h.move(tile("g2"));
    time.advance(300);
    expect(h.open).toBeNull();
    time.advance(150);
    expect(h.open).toBe("g2");
  });

  test("does nothing while disabled, such as in edit mode", () => {
    const h = harness({ isEnabled: () => false });
    h.move(tile("g1"));
    time.advance(5000);
    expect(h.open).toBeNull();
    expect(h.hovered).toEqual([]);
  });

  test("only looks at the topmost element, so a backdrop over a tile blocks it", () => {
    const h = harness();
    h.move(backdrop(), tile("g1"));
    time.advance(5000);
    expect(h.open).toBeNull();
  });
});

describe("closing an auto-opened group", () => {
  function openedByDrag() {
    const h = harness();
    h.move(tile("g1"));
    time.advance(FILE_DRAG_GROUP_DWELL_MS);
    return h;
  }

  test("stays open until the pointer has been inside it", () => {
    const h = openedByDrag();
    // The group opens under a pointer that is still over the backdrop.
    h.move(backdrop());
    h.move(backdrop());
    expect(h.open).toBe("g1");
  });

  test("closes after the dwell once the pointer moves out after having been inside", () => {
    const h = openedByDrag();
    h.move(popup("g1"));
    expect(h.open).toBe("g1");
    h.move(backdrop());
    expect(h.open).toBe("g1");

    time.advance(FILE_DRAG_GROUP_DWELL_MS - 1);
    expect(h.open).toBe("g1");
    time.advance(1);
    expect(h.open).toBeNull();
  });

  test("does not restart the close delay while the pointer stays outside", () => {
    const h = openedByDrag();
    h.move(popup("g1"));
    h.move(backdrop());
    time.advance(300);
    h.move(backdrop());
    time.advance(150);
    expect(h.open).toBeNull();
  });

  test("stays open if the pointer comes back before the delay ends", () => {
    const h = openedByDrag();
    const inside = popup("g1");
    h.move(inside);
    h.move(backdrop());
    time.advance(FILE_DRAG_GROUP_DWELL_MS - 100);
    h.move(inside);
    time.advance(5000);
    expect(h.open).toBe("g1");
  });

  test("starts a fresh delay each time the pointer leaves again", () => {
    const h = openedByDrag();
    const inside = popup("g1");
    h.move(inside);
    h.move(backdrop());
    time.advance(300);
    h.move(inside);
    h.move(backdrop());
    time.advance(300);
    expect(h.open).toBe("g1");
    time.advance(150);
    expect(h.open).toBeNull();
  });

  test("a drop during the close delay keeps the group open", () => {
    const h = openedByDrag();
    h.move(popup("g1"));
    h.move(backdrop());
    h.drop(backdrop());
    time.advance(5000);
    expect(h.open).toBe("g1");
  });

  test("a group the user switched away from is not closed by a pending delay", () => {
    const h = openedByDrag();
    h.move(popup("g1"));
    h.move(backdrop());
    h.open = "g2";
    h.move(backdrop());
    time.advance(5000);
    expect(h.open).toBe("g2");
  });

  test("stays open while the pointer moves between elements inside the group", () => {
    const h = openedByDrag();
    const inside = popup("g1");
    h.move(inside);
    h.move(inside.parentElement);
    h.move(inside);
    expect(h.open).toBe("g1");
  });

  test("closes when the drag is cancelled or leaves the window", () => {
    const h = openedByDrag();
    h.move(popup("g1"));
    h.end();
    expect(h.open).toBeNull();
  });

  test("closes on cancel even if the pointer never entered the group", () => {
    const h = openedByDrag();
    h.end();
    expect(h.open).toBeNull();
  });

  test("keeps the group open after a drop", () => {
    const h = openedByDrag();
    const inside = popup("g1");
    h.move(inside);
    h.drop(inside);
    expect(h.open).toBe("g1");
    // A later drag does not close it either: it is no longer drag-owned.
    h.move(backdrop());
    h.end();
    expect(h.open).toBe("g1");
  });

  test("never closes a group the user opened themselves", () => {
    const h = harness();
    h.open = "g1";
    h.move(popup("g1"));
    h.move(backdrop());
    h.end();
    expect(h.open).toBe("g1");
  });

  test("does not start opening another group while a user-opened one is showing", () => {
    const h = harness();
    h.open = "g1";
    h.move(tile("g2"));
    time.advance(5000);
    expect(h.open).toBe("g1");
  });

  test("forgets a group the user closed by hand, so it is not closed again later", () => {
    const h = openedByDrag();
    h.move(popup("g1"));
    h.open = null;
    h.move(popup("g1"));
    h.open = "g2";
    h.move(backdrop());
    expect(h.open).toBe("g2");
  });
});

describe("drops and cleanup", () => {
  test("reports a drop on a tile that has not opened yet and cancels its dwell", () => {
    const h = harness();
    const button = tile("g1");
    h.move(button);
    h.drop(button);
    time.advance(5000);
    expect(h.dropsOnClosed).toEqual(["g1"]);
    expect(h.open).toBeNull();
  });

  test("does not report a drop that lands inside an open group", () => {
    const h = harness();
    h.open = "g1";
    h.drop(popup("g1"));
    expect(h.dropsOnClosed).toEqual([]);
  });

  test("stop unsubscribes and cancels a pending dwell", () => {
    const h = harness();
    h.move(tile("g1"));
    h.stop();
    time.advance(5000);
    expect(h.open).toBeNull();
    expect(h.watching).toBe(false);
  });
});
