import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('copying the redacted report keeps the share link for the same crash', async () => {
  const source = await Bun.file(new URL('../src/pages/library/instance/crash-tab.tsx', import.meta.url)).text();
  // Exercise the real actions and Solid state with a local clipboard and no upload.
  const setup = source.slice(source.indexOf('const fixtureReport'), source.lastIndexOf('  return ('));
  const contents = `
    import { createRoot, createSignal, createMemo, createEffect, onCleanup, untrack, flush } from 'solid-js';
    const recordFor = (details) => ({ name: 'Test pack', crashDetails: JSON.stringify(details) });
    const [nativeRecord, setRecord] = createSignal(recordFor({ crash_id: 'first' }));
    const nativeInstances = true;
    const parseNativeCrash = JSON.parse;
    const instanceSlug = () => 'test-pack';
    const performNative = (_id, action) => action(untrack(nativeRecord));
    const t = (id) => id;
    const clipboard = [];
    const navigator = { clipboard: { writeText: async (text) => { clipboard.push(text); } } };
    const invoke = async (command, args) => {
      if (command === 'read_crash_report') return \`Report for \${args.crashId} [redacted]\`;
      if (command === 'upload_crash_to_mclogs') return { url: 'https://mclo.gs/example' };
      throw new Error(command);
    };
    ${setup}
      return { sharedUrl, report, share, copy, feedback };
    }
    export { createRoot, clipboard, flush, setRecord, recordFor, untrack };
  `;
  const built = await Bun.build({
    entrypoints: ['crash-sharing-check'],
    target: 'bun',
    conditions: ['browser', 'development'],
    plugins: [{ name: 'crash-sharing-check', setup(build) {
      build.onResolve({ filter: /^crash-sharing-check$/ }, () => ({ path: 'check', namespace: 'crash-check' }));
      build.onLoad({ filter: /.*/, namespace: 'crash-check' }, () => ({
        contents, loader: 'ts', resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      }));
    } }],
  });
  if (!built.success) throw new AggregateError(built.logs);
  const api = await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0].arrayBuffer()).toString('base64')}`);
  const owner = api.createRoot(dispose => ({ dispose, tab: api.CrashTab({ entry: { instance: { id: '7' } } }) }));
  const { tab } = owner;
  const { untrack } = api;
  try {
    api.flush();
    await Promise.resolve();
    api.flush();
    await tab.share();
    api.flush();
    expect(untrack(tab.sharedUrl)).toBe('https://mclo.gs/example');
    await tab.copy(untrack(tab.report), 'report');
    api.flush();
    expect(api.clipboard).toEqual(['Report for first [redacted]']);
    expect(untrack(tab.feedback).message).toBe('crash.report-copied');
    expect(untrack(tab.sharedUrl)).toBe('https://mclo.gs/example');
    api.setRecord(api.recordFor({ crash_id: 'second', mclogs_url: 'https://mclo.gs/saved' }));
    api.flush();
    expect(untrack(tab.sharedUrl)).toBe('https://mclo.gs/saved');
  } finally {
    owner.dispose();
  }
});
