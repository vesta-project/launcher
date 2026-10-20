import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function storeHarness() {
  const built = await Bun.build({
    entrypoints: [new URL('../src/features/activity/activity-store.ts', import.meta.url).pathname],
    target: 'bun', conditions: ['browser', 'development'],
    plugins: [{ name: 'activity-clock', setup(build) {
      build.onLoad({ filter: /activity-store\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents: `
        import { flush, untrack } from 'solid-js';
        export { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
        let now = 10000; let id = 0; const timers = new Map();
        const Date = { now: () => now };
        function setTimeout(fn, delay) { timers.set(++id, { fn, at: now + delay }); return id; }
        function clearTimeout(id) { timers.delete(id); }
        export function advance(ms) {
          const end = now + ms;
          while (true) {
            const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
            if (!due) break;
            now = due[1].at; timers.delete(due[0]); due[1].fn(); flush();
          }
          now = end; flush();
        }
        export const snapshot = () => untrack(() => ({ rows: activities(), pill: pillState() }));
        export const timerCount = () => timers.size;
      ` + await Bun.file(path).text() }));
    } }],
  });
  if (!built.success) throw new AggregateError(built.logs);
  const dir = await mkdtemp(join(tmpdir(), 'vesta-activity-check-'));
  try {
    const path = join(dir, 'store.mjs');
    await Bun.write(path, built.outputs[0]);
    return await import(pathToFileURL(path).href);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('reactive store coalesces deltas, preserves terminal transitions and wakes at visibility boundaries', async () => {
  const store = await storeHarness();
  const { artifact } = await store.captureArtifact(() => {
    store.receiveActivity({ id: 'install', title: 'Install', state: 'running', progress: 0 });
    store.advance(0);
    for (let i = 1; i <= 100; i++) store.receiveActivity({ id: 'install', progress: i / 100 }, true);
    expect(store.timerCount()).toBe(1);
    expect(store.snapshot().rows[0].progress).toBe(0);
    store.advance(99);
    expect(store.snapshot().rows[0].progress).toBe(0);
    store.advance(1);
    expect(store.snapshot().rows[0].progress).toBe(1);
    store.receiveActivity({ id: 'install', progress: 0.9 }, true);
    store.receiveActivity({ id: 'install', state: 'done' });
    store.advance(0);
    expect(store.snapshot().pill.state).toBe('success');
    store.advance(5999);
    expect(store.snapshot().pill.state).toBe('success');
    store.advance(1);
    expect(store.snapshot().pill.state).toBe('idle');
    expect(store.snapshot().rows).toHaveLength(1);
    store.receiveActivity({ id: 'ready', title: 'Pack', state: 'running', action: 'play', target: { instanceId: '7' } });
    store.receiveActivity({ id: 'ready', state: 'done' });
    store.advance(60_000);
    expect(store.snapshot().pill.state).toBe('ready');
    expect(store.timerCount()).toBe(0);
    store.markInstancesPlayed(['7']);
    store.advance(0);
    expect(store.snapshot().pill.state).toBe('idle');
    store.receiveActivity({ id: 'quiet', kind: 'background', title: 'Index', state: 'running' });
    store.advance(1499);
    expect(store.snapshot().pill.state).toBe('idle');
    store.advance(1);
    expect(store.snapshot().pill.state).toBe('quiet');
    store.receiveActivity({ id: 'quiet', state: 'failed', error: 'offline' });
    store.advance(1_000_000);
    expect(store.snapshot().pill.state).toBe('failed');
    store.markSeen();
    store.advance(0);
    expect(store.snapshot().pill.state).toBe('idle');
    store.stopActivityTimers();
    expect(store.timerCount()).toBe(0);
  }, { scenario: 'activity-progress-and-timer-boundaries' });
  store.expectNoDiagnostics(artifact);
});
