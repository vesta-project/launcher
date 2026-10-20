import { describe, expect, test } from "bun:test";
import {
  createGroup,
  createLibraryLayoutStore,
  customOrder,
  moveEntry,
  parseLayout,
  reconcileLayout,
  serializeLayout,
} from "../src/features/instances/library-layout";

const doc = (value) => JSON.stringify(value);

describe("parsing the saved layout", () => {
  test("anything that is not a version 1 document is an empty layout", () => {
    for (const raw of [null, "", "not json", doc({ version: 2, order: [1] }), doc([1, 2])]) {
      expect(parseLayout(raw)).toEqual({ version: 1, sort: "recent", order: [], groups: [] });
    }
  });

  test("host numeric ids become strings, duplicates and dangling entries are dropped", () => {
    const layout = parseLayout(doc({
      version: 1,
      sort: "custom",
      order: [3, "group:a", 3, "group:missing", 1.5, 2, 4],
      groups: [
        { id: "group:a", name: "  Modded  ", color: 265, instances: [4, 4, 5] },
        { id: "group:a", name: "Duplicate", instances: [6] },
        { id: "not-a-group", name: "Bad", instances: [7] },
        { id: "group:b", name: "", color: 999, instances: [5] },
      ],
    }));
    expect(layout.sort).toBe("custom");
    expect(layout.groups).toEqual([
      { id: "group:a", name: "Modded", color: 265, instances: ["4", "5"] },
      { id: "group:b", name: "Group", color: 205, instances: [] },
    ]);
    // 4 is grouped, so it leaves the top level; group:b is appended because the order forgot it.
    expect(layout.order).toEqual(["3", "group:a", "2", "group:b"]);
  });

  test("names are clipped to 60 characters and unknown sorts fall back to recent", () => {
    const layout = parseLayout(doc({ version: 1, sort: "weird", order: [], groups: [{ id: "group:x", name: "x".repeat(90), instances: [1] }] }));
    expect(layout.groups[0].name).toHaveLength(60);
    expect(layout.sort).toBe("recent");
  });

  test("serialising gives the host numbers back and keeps fixture ids as strings", () => {
    const layout = { version: 1, sort: "custom", order: ["12", "survival", "group:a"], groups: [{ id: "group:a", name: "A", color: 205, instances: ["7"] }] };
    expect(JSON.parse(serializeLayout(layout))).toEqual({
      version: 1, sort: "custom", order: [12, "survival", "group:a"], groups: [{ id: "group:a", name: "A", color: 205, instances: [7] }],
    });
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
  });
});

describe("ordering", () => {
  const base = { version: 1, sort: "custom", order: ["b", "group:g", "a"], groups: [{ id: "group:g", name: "G", color: 205, instances: ["c"] }] };

  test("new instances join at the end and grouped or deleted ones leave the top level", () => {
    expect(customOrder(base, ["a", "b", "c", "d"])).toEqual(["b", "group:g", "a", "d"]);
    expect(customOrder(base, ["b", "c"])).toEqual(["b", "group:g"]);
  });

  test("moves within the top level, into a group and out of it", () => {
    const ids = ["a", "b", "c"];
    expect(customOrder(moveEntry(base, ids, "a", null, "b"), ids)).toEqual(["a", "b", "group:g"]);
    const into = moveEntry(base, ids, "a", "group:g", "c");
    expect(into.groups[0].instances).toEqual(["a", "c"]);
    expect(customOrder(into, ids)).toEqual(["b", "group:g"]);
    const out = moveEntry(into, ids, "a", null, null);
    expect(customOrder(out, ids)).toEqual(["b", "group:g", "a"]);
  });

  test("a group that empties disappears, along with its place in the order", () => {
    const ids = ["a", "b", "c"];
    const moved = moveEntry(base, ids, "c", null, "b");
    expect(moved.groups).toEqual([]);
    expect(customOrder(moved, ids)).toEqual(["c", "b", "a"]);
  });

  test("groups never go inside groups", () => {
    expect(moveEntry(base, ["a"], "group:g", "group:g", null)).toBe(base);
  });

  test("a new group takes the place of its first member", () => {
    const ids = ["a", "b", "c"];
    const grouped = createGroup(base, ids, ["a", "b"], "group:new", "New group");
    expect(customOrder(grouped, ids)).toEqual(["group:new", "group:g"]);
    expect(grouped.groups.at(-1)).toMatchObject({ id: "group:new", instances: ["a", "b"] });
  });

  test("ordering 300 instances stays linear", () => {
    const ids = Array.from({ length: 300 }, (_, index) => String(index));
    const layout = { version: 1, sort: "custom", order: [...ids].reverse(), groups: [] };
    const started = performance.now();
    for (let index = 0; index < 50; index++) customOrder(layout, ids);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("reconciling", () => {
  test("deleted instances leave their groups; nothing changed returns null", () => {
    const layout = { version: 1, sort: "custom", order: ["group:g", "a"], groups: [{ id: "group:g", name: "G", color: 205, instances: ["x"] }] };
    const next = reconcileLayout(layout, ["a"]);
    expect(next.groups).toEqual([]);
    expect(next.order).toEqual(["a"]);
    expect(reconcileLayout(next, ["a"])).toBeNull();
  });
});

describe("the store", () => {
  function harness(saved = null) {
    const writes = [];
    const store = createLibraryLayoutStore({
      load: async () => saved,
      save: async (document) => { writes.push(JSON.parse(document)); },
    });
    return { store, writes };
  }

  test("nothing is saved or reconciled before the saved layout has loaded", async () => {
    const { store, writes } = harness(doc({ version: 1, sort: "custom", order: [1], groups: [] }));
    store.commit({ version: 1, sort: "custom", order: [], groups: [] });
    store.reconcile([]);
    await store.flush();
    expect(writes).toEqual([]);
    await store.load();
    expect(store.layout().order).toEqual(["1"]);
  });

  test("previews are shown without saving; the drop saves once", async () => {
    const { store, writes } = harness(doc({ version: 1, sort: "custom", order: [1, 2, 3], groups: [] }));
    await store.load();
    const ids = ["1", "2", "3"];
    // A live reorder during a drag passes through several slots.
    store.preview(moveEntry(store.layout(), ids, "3", null, "2"));
    store.preview(moveEntry(store.layout(), ids, "3", null, "1"));
    expect(customOrder(store.layout(), ids)).toEqual(["3", "1", "2"]);
    await store.flush();
    expect(writes).toHaveLength(0);
    store.commit();
    await store.flush();
    expect(writes).toEqual([{ version: 1, sort: "custom", order: [3, 1, 2], groups: [] }]);
  });

  test("a failed load stays unloaded so it cannot overwrite the real layout", async () => {
    const writes = [];
    const store = createLibraryLayoutStore({ load: async () => { throw new Error("offline"); }, save: async (document) => { writes.push(document); } });
    const error = console.error;
    console.error = () => {};
    await store.load();
    console.error = error;
    expect(store.loaded()).toBe(false);
    expect(store.saveError()).toBe(true);
    store.commit();
    await store.flush();
    expect(writes).toEqual([]);
  });
});

test("overlapping loads share one read and cannot revert a completed reorder", async () => {
  const reads = [], writes = [];
  const store = createLibraryLayoutStore({ load: () => new Promise((resolve) => reads.push(resolve)), save: async (value) => writes.push(JSON.parse(value)) });
  const first = store.load(), second = store.load();
  await Promise.resolve();
  reads[0](doc({ version: 1, sort: "custom", order: [1, 2], groups: [] })); await first;
  store.commit(moveEntry(store.layout(), ["1", "2"], "2", null, "1")); await store.flush();
  // An implementation issuing duplicate reads receives the old snapshot after the save.
  reads[1]?.(doc({ version: 1, sort: "custom", order: [1, 2], groups: [] }));
  await second; await store.load();
  expect(store.layout().order).toEqual(["2", "1"]); expect(writes[0].order).toEqual([2, 1]); expect(reads).toHaveLength(1);
});
test("shared failed load allows a fresh shared retry", async () => {
  const reads = [];
  const store = createLibraryLayoutStore({ load: () => new Promise((resolve, reject) => reads.push({ resolve, reject })), save: async () => {} });
  const first = store.load(); expect(store.load()).toBe(first); await Promise.resolve();
  const error = console.error; console.error = () => {};
  try { reads[0].reject(new Error("offline")); await first; } finally { console.error = error; }
  expect(store.loaded()).toBe(false); expect(store.saveError()).toBe(true);
  const retry = store.load(); expect(retry).not.toBe(first); expect(store.load()).toBe(retry); await Promise.resolve(); expect(reads).toHaveLength(2);
  reads[1].resolve(doc({ version: 1, sort: "custom", order: [2, 1], groups: [] })); await retry;
  expect(store.loaded()).toBe(true); expect(store.saveError()).toBe(false); expect(store.layout().order).toEqual(["2", "1"]);
});
