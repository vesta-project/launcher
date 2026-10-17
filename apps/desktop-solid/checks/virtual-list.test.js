import { describe, expect, test } from "bun:test";
import { rowOffsets, virtualWindow } from "../src/components/virtual-window";

describe("shared list window math", () => {
  test("empty and short lists have no phantom rows", () => {
    expect(rowOffsets(0, 44)).toEqual([0]);
    expect(virtualWindow([0], 0, 600)).toEqual({ start: 0, end: 0, total: 0 });
    expect(virtualWindow(rowOffsets(3, 44), 900, 600)).toEqual({
      start: 0,
      end: 3,
      total: 132,
    });
  });

  test("exact boundaries exclude the row ending at the top and starting at the bottom", () => {
    const offsets = rowOffsets(100, 44);
    expect(virtualWindow(offsets, 44, 88, 0)).toEqual({
      start: 1,
      end: 3,
      total: 4400,
    });
    expect(virtualWindow(offsets, 45, 88, 0)).toEqual({
      start: 1,
      end: 4,
      total: 4400,
    });
    expect(virtualWindow(offsets, -50, 88, 0)).toEqual({
      start: 0,
      end: 2,
      total: 4400,
    });
  });

  test("default overscan stays bounded at either end and after filtering shrinks content", () => {
    const offsets = rowOffsets(1000, 44);
    expect(virtualWindow(offsets, 0, 440)).toEqual({
      start: 0,
      end: 18,
      total: 44000,
    });
    expect(virtualWindow(offsets, 4400, 440)).toEqual({
      start: 92,
      end: 118,
      total: 44000,
    });
    expect(virtualWindow(offsets, 440000, 440)).toEqual({
      start: 982,
      end: 1000,
      total: 44000,
    });
    expect(virtualWindow(rowOffsets(20, 44), 44000, 440)).toEqual({
      start: 2,
      end: 20,
      total: 880,
    });
  });

  test("pack and own group heights participate in the same prefix sums", () => {
    const heights = [52, 44, 44, 36, 44];
    const offsets = rowOffsets(heights.length, 44, (index) => heights[index]);
    expect(offsets).toEqual([0, 52, 96, 140, 176, 220]);
    expect(virtualWindow(offsets, 52, 88, 0)).toEqual({
      start: 1,
      end: 3,
      total: 220,
    });
    expect(virtualWindow(offsets, 140, 36, 0)).toEqual({
      start: 3,
      end: 4,
      total: 220,
    });
    expect(() => rowOffsets(1, 0)).toThrow(RangeError);
    expect(() => rowOffsets(2, 44, () => NaN)).toThrow(RangeError);
  });

  test("binary search agrees with intersection checks across mixed rows", () => {
    const offsets = rowOffsets(321, 44, (index) =>
      index % 17 === 0 ? 52 : index % 23 === 0 ? 36 : 44,
    );
    const total = offsets.at(-1);
    for (const height of [1, 20, 333, 600, total + 1]) {
      for (let scroll = -19; scroll < total + 200; scroll += 137) {
        const top = Math.max(0, Math.min(scroll, Math.max(0, total - height)));
        const bottom = Math.min(total, top + height);
        const intersecting = offsets
          .slice(0, -1)
          .flatMap((offset, index) =>
            offset < bottom && offsets[index + 1] > top ? [index] : [],
          );
        const window = virtualWindow(offsets, scroll, height, 0);
        expect(window.start).toBe(intersecting[0]);
        expect(window.end).toBe(intersecting.at(-1) + 1);
      }
    }
  });

  test("600px viewport mounts at most 30 resources or 47 console lines, independent of source length", () => {
    for (const [count, rowHeight, height, budget] of [
      [1000, 44, 568, 30],
      [5000, 20, 600, 47],
    ]) {
      const offsets = rowOffsets(count, rowHeight);
      for (let top = 0; top <= offsets.at(-1); top += 113) {
        const { start, end } = virtualWindow(offsets, top, height);
        expect(end - start).toBeLessThanOrEqual(budget);
      }
    }
  });
});
