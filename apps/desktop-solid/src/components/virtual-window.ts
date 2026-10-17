/** End offsets are exclusive; every row has a finite, positive fixed height. */
export function rowOffsets(
  count: number,
  rowHeight: number,
  getHeight?: (index: number) => number,
): number[] {
  const offsets = [0];
  for (let index = 0; index < count; index++) {
    const height = getHeight?.(index) ?? rowHeight;
    if (!Number.isFinite(height) || height <= 0)
      throw new RangeError("Row height must be positive and finite");
    offsets.push(offsets[index] + height);
  }
  return offsets;
}

export function virtualWindow(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 8,
) {
  const count = Math.max(0, offsets.length - 1);
  const total = offsets[count] ?? 0;
  const height = Math.max(0, viewportHeight);
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, total - height)));
  const bottom = Math.min(total, top + height);
  // First row whose end is beyond the viewport's top.
  let low = 0,
    high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid + 1] <= top) low = mid + 1;
    else high = mid;
  }
  const first = low;
  // First row whose start is at or beyond the viewport's bottom.
  low = first;
  high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] < bottom) low = mid + 1;
    else high = mid;
  }
  const padding = Math.max(0, Math.floor(overscan));
  return {
    start: Math.max(0, first - padding),
    end: Math.min(count, low + padding),
    total,
  };
}
