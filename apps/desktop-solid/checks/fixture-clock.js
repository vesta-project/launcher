/** Advance preview request delays and job time without changing global timers. */
export function fixtureClock() {
  let now = Date.UTC(2026, 0, 1);
  return {
    now: () => now,
    async wait(ms) { now += ms; },
    advance(ms) { now += ms; },
  };
}
