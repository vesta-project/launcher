import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseInstanceShortcutArgs } from '../src/features/instances/shortcut-intent-model';

test('shortcut intents accept host CLI and encoded macOS deep links', () => {
  expect(parseInstanceShortcutArgs(['--launch-instance', 'my-pack', '--open-instance', 'other'])).toEqual([
    { slug: 'my-pack', launch: true }, { slug: 'other', launch: false },
  ]);
  expect(parseInstanceShortcutArgs(['vesta://launch-instance?slug=my%20pack', 'vesta://open-instance/other'])).toEqual([
    { slug: 'my pack', launch: true }, { slug: 'other', launch: false },
  ]);
});

test('malformed and unrelated arguments cannot launch an instance', () => {
  expect(parseInstanceShortcutArgs(['--launch-instance', '--open-instance', '', 'vesta://launch-instance', 'vesta://open-resource/foo', 'vesta://launch-instance/%ZZ', 'https://example.com'])).toEqual([]);
});

async function nativeHarness() {
  const built = await Bun.build({
    entrypoints: [new URL('../src/features/instances/native-service.ts', import.meta.url).pathname],
    target: 'bun', conditions: ['browser', 'development'],
    plugins: [{ name: 'shortcut-host', setup(build) {
      build.onResolve({ filter: /^(@tauri-apps\/api\/(core|event)|\.\.\/accounts\/accounts|\.\/icon-catalog)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents:
        path.endsWith('/core') ? `
          export const calls = []; let running = false;
          export const setRunning = value => { running = value; calls.length = 0; };
          const record = { id: 1, name: 'My Pack', installationStatus: 'installed' };
          export const isTauri = () => true; export const convertFileSrc = value => value;
          export async function invoke(command, args) {
            calls.push({ command, args });
            if (command === 'get_instance') return record;
            if (command === 'list_instances') return [record];
            if (command === 'is_instance_running') return running;
            if (command === 'get_running_instances') return [];
          }
        ` : path.endsWith('/event') ? 'export const listen = async () => () => {};' :
        path.endsWith('/accounts') ? "export const activeAccount = () => ({uuid:'account', account_type:'microsoft'});" :
        'export const resolveInstanceIcon = value => value; export const stableIconId = value => value;',
      }));
      build.onLoad({ filter: /native-service\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents:
        'const window = {};\n' + await Bun.file(path).text() + "\nexport { calls, setRunning } from '@tauri-apps/api/core';",
      }));
    } }],
  });
  if (!built.success) throw new AggregateError(built.logs, 'Shortcut harness failed');
  const directory = await mkdtemp(join(tmpdir(), 'vesta-shortcut-check-'));
  try {
    const path = join(directory, 'service.mjs');
    await Bun.write(path, built.outputs[0]);
    return await import(pathToFileURL(path).href);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('direct-launch shortcuts start an idle instance but never stop an already running game', async () => {
  const service = await nativeHarness();
  service.setRunning(false);
  expect(await service.launchNativeInstance('1')).toBe(true);
  expect(service.calls.filter(call => call.command === 'launch_instance')).toHaveLength(1);
  expect(service.calls.some(call => call.command === 'kill_instance')).toBe(false);
  service.setRunning(true);
  expect(await service.launchNativeInstance('1')).toBe(true);
  expect(service.calls.some(call => ['launch_instance', 'kill_instance'].includes(call.command))).toBe(false);
  expect(await service.runInstance('1')).toBe(true);
  expect(service.calls.filter(call => call.command === 'kill_instance')).toHaveLength(1);
});
