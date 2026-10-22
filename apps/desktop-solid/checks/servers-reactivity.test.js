import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let builtHarness;
const harness = () => (builtHarness ??= buildHarness());

async function buildHarness() {
  const connectionIdPath = fileURLToPath(new URL('../src/features/servers/connection-id.ts', import.meta.url));
  const storePath = fileURLToPath(new URL('../src/features/servers/store.ts', import.meta.url));
  const servicePath = fileURLToPath(new URL('../src/features/servers/service.ts', import.meta.url));
  const built = await Bun.build({
    entrypoints: ['vesta-server-reactivity-check'], target: 'bun', conditions: ['browser', 'development'],
    plugins: [{ name: 'server-reactivity-check', setup(build) {
      build.onLoad({ filter: /features[\\/]servers[\\/]service\.ts$/ }, () => ({ loader: 'js', contents: `
        export const counts = { opened: 0, closed: 0 };
        const api = { subscribe: async () => { counts.opened++; return () => counts.closed++; } };
        export const serversApi = async () => api;
      ` }));
      build.onResolve({ filter: /^vesta-server-reactivity-check$/ }, () => ({ path: 'check', namespace: 'server-check' }));
      build.onLoad({ filter: /.*/, namespace: 'server-check' }, () => ({ loader: 'js', resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
        import { createEffect, createRoot, createSignal, flush } from 'solid-js';
        import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
        import { stableConnectionId } from ${JSON.stringify(connectionIdPath)};
        import { useServerTopic } from ${JSON.stringify(storePath)};
        import { counts } from ${JSON.stringify(servicePath)};
        export { captureArtifact, expectNoDiagnostics };
        export function scenario(assert) {
          const owner = createRoot(dispose => {
            const [snapshot, setSnapshot] = createSignal({ connection: { id: 'one' }, observation: 0 }, { name: 'server-check:snapshot' });
            const id = stableConnectionId(snapshot);
            let loads = 0, draft = false, error = null;
            createEffect(id, () => { loads++; draft = false; error = null; }, { name: 'server-check:load-policy' });
            return { dispose, setSnapshot, edit: () => { draft = true; error = 'rate_limited'; }, state: () => ({ loads, draft, error }) };
          });
          try {
            flush(); owner.edit();
            for (let observation = 1; observation <= 60; observation++) {
              owner.setSnapshot({ connection: { id: 'one' }, observation }); flush();
            }
            assert(owner.state(), 'same-server');
            owner.setSnapshot({ connection: { id: 'two' }, observation: 61 }); flush();
            assert(owner.state(), 'different-server');
          } finally { owner.dispose(); }
        }
        export async function topicScenario(assert) {
          const owner = createRoot(dispose => {
            const [snapshot, setSnapshot] = createSignal({ connection: { id: 'one' }, observation: 0 }, { name: 'server-check:topic-snapshot' });
            useServerTopic(() => snapshot().connection.id, 'status');
            return { dispose, setSnapshot };
          });
          const settle = async () => { flush(); await new Promise(resolve => setTimeout(resolve, 0)); flush(); };
          try {
            await settle();
            for (let observation = 1; observation <= 60; observation++) {
              owner.setSnapshot({ connection: { id: 'one' }, observation }); flush();
            }
            await settle(); assert({ ...counts }, 'same-server');
            owner.setSnapshot({ connection: { id: 'two' }, observation: 61 });
            await settle(); assert({ ...counts }, 'different-server');
          } finally { owner.dispose(); }
          assert({ ...counts }, 'disposed');
        }
      ` }));
    } }],
  });
  if (!built.success) throw new AggregateError(built.logs);
  const dir = await mkdtemp(join(tmpdir(), 'vesta-server-reactivity-'));
  try {
    const path = join(dir, 'check.mjs');
    await Bun.write(path, built.outputs[0]);
    return await import(pathToFileURL(path).href);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('live status updates preserve sleep drafts and errors without refetching policy', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(() => {
    check.scenario((state, phase) => {
      expect(state).toEqual(phase === 'same-server'
        ? { loads: 1, draft: true, error: 'rate_limited' }
        : { loads: 2, draft: false, error: null });
    });
  }, { scenario: 'server-settings-draft-during-live-status' });
  check.expectNoDiagnostics(artifact);
});

test('live snapshots do not reconnect subscriptions until server identity changes', async () => {
  const check = await harness();
  const { artifact } = await check.captureArtifact(async () => {
    await check.topicScenario((counts, phase) => {
      expect(counts).toEqual(phase === 'same-server' ? { opened: 1, closed: 0 }
        : phase === 'different-server' ? { opened: 2, closed: 1 } : { opened: 2, closed: 2 });
    });
  }, { scenario: 'server-subscriptions-during-live-status' });
  check.expectNoDiagnostics(artifact);
});
