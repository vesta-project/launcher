/**
 * Browser-preview fixtures only. `localStorage['vesta:fixture-rows'] = '250'` pads list fixtures
 * (installed resources, server content) to that many rows so list rendering can be profiled at
 * the sizes real modpacks reach. Native builds never read fixtures.
 */
export function fixtureRowTarget(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem('vesta:fixture-rows'));
    return Number.isInteger(value) && value > 0 ? Math.min(value, 5000) : 0;
  } catch { return 0; }
}

export function scaleFixtureRows<T>(rows: T[], vary: (row: T, copy: number) => T): T[] {
  const target = fixtureRowTarget();
  if (!target || rows.length === 0 || rows.length >= target) return rows;
  return Array.from({ length: target }, (_, index) => index < rows.length
    ? rows[index] : vary(rows[index % rows.length], Math.floor(index / rows.length)));
}
