import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('startup stays light, Settings intent enables scans, and disposal cancels idle work', async () => {
  const resources = fileURLToPath(new URL('../src/features/settings/resources.ts', import.meta.url));
  const navigation = fileURLToPath(new URL('../src/app/navigation-preload.ts', import.meta.url));
  const built = await Bun.build({ entrypoints: ['startup-check'], target: 'bun', conditions: ['browser', 'development'], plugins: [{ name: 'startup-check', setup(build) {
    build.onResolve({ filter: /^(startup-check|startup-observer)$/ }, (args) => ({ path: args.path, namespace: 'startup-check' }));
    build.onLoad({ filter: /.*/, namespace: 'startup-check' }, (args) => ({ loader: 'js', resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: args.path === 'startup-observer'
      ? 'export const calls = []'
      : `export { createRoot, flush } from 'solid-js'; export { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics'; export { calls } from 'startup-observer'; export { prefetchSettings, prefetchSettingsWhenIdle } from ${JSON.stringify(resources)}; export { useNavigationPreloading } from ${JSON.stringify(navigation)};` }));
    build.onLoad({ filter: /settings[\\/]cached-resource\.ts$/ }, () => ({ loader: 'js', contents: `import { calls } from 'startup-observer'; export const cachedResource = ({key}) => ({refresh: async () => calls.push(key)});` }));
    for (const [file, exported] of [['notifications', 'notificationSubscriptions'], ['shortcuts', 'shortcutCatalog'], ['sync', 'settingsSync']]) {
      build.onLoad({ filter: new RegExp(`settings[\\\\/]${file}\\.ts$`) }, () => ({ loader: 'js', contents: `import { calls } from 'startup-observer'; export const ${exported} = {refresh: async () => calls.push('${file}')};` }));
    }
    build.onLoad({ filter: /activity[\\/]activity-store\.ts$/ }, () => ({ loader: 'js', contents: 'export const runBackgroundActivity = (_, run) => run();' }));
    build.onLoad({ filter: /localization[\\/]index\.ts$/ }, () => ({ loader: 'js', contents: 'export const t = key => key;' }));
    build.onLoad({ filter: /pages[\\/]servers[\\/]nav-prefetch\.ts$/ }, () => ({ loader: 'js', contents: "import { calls } from 'startup-observer'; export const prefetchServerOpen = id => calls.push('server:' + id);" }));
    build.onLoad({ filter: /app[\\/]router\.ts$/ }, () => ({ loader: 'js', contents: "export const route = () => ({page:'library'});" }));
    build.onLoad({ filter: /browse[\\/]browse-store\.ts$/ }, () => ({ loader: 'js', contents: "import { calls } from 'startup-observer'; export const prefetchBrowse = () => calls.push('browse');" }));
    build.onLoad({ filter: /browse[\\/]browse-projects\.ts$/ }, () => ({ loader: 'js', contents: 'export const prefetchProject = () => {};' }));
  } }] });
  if (!built.success) throw new AggregateError(built.logs);
  const dir = await mkdtemp(join(tmpdir(), 'vesta-startup-check-'));
  try {
    const path = join(dir, 'check.mjs'); await Bun.write(path, built.outputs[0]);
    // Run this bundle in its own realm; loading another bundled Solid into the
    // test runner would itself produce a multiple-instance diagnostic.
    const runner = join(dir, 'run.mjs');
    await Bun.write(runner, `
    import assert from 'node:assert/strict';
    const idle = new Map(); let next = 0;
    globalThis.window = { requestIdleCallback: run => { idle.set(++next, run); return next; }, cancelIdleCallback: id => idle.delete(id) };
    globalThis.document = { addEventListener: () => {}, removeEventListener: () => {} };
    const check = await import(${JSON.stringify(pathToFileURL(path).href)});
    const { artifact } = await check.captureArtifact(() => {
      const owner = check.createRoot((dispose) => { check.prefetchSettingsWhenIdle(); check.useNavigationPreloading(); return { dispose }; });
      check.flush();
      assert.deepEqual(check.calls, []);
      assert.equal(idle.size, 1);
      for (const [id, run] of idle) { idle.delete(id); run(); }
      assert(!check.calls.includes('java-inventory'));
      assert(!check.calls.includes('storage-usage'));
      assert(!check.calls.includes('browse'));
      check.prefetchSettings();
      assert(check.calls.includes('java-inventory'));
      assert(check.calls.includes('storage-usage'));
      owner.dispose();
      const second = check.createRoot((dispose) => { check.prefetchSettingsWhenIdle(); return { dispose }; });
      check.flush(); assert.equal(idle.size, 1);
      second.dispose(); assert.equal(idle.size, 0);
    }, { scenario: 'startup-heavy-work-waits-for-intent' });
    check.expectNoDiagnostics(artifact);
    `);
    const child = Bun.spawn([process.execPath, runner], { stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: '', stderr: '' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
