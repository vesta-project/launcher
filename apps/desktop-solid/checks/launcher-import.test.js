import { expect, test } from 'bun:test';
import { createLauncherImport } from '../src/features/launcher-import/service';
import { fixtureCandidates, fixtureLaunchers } from '../src/features/launcher-import/fixtures';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function setup(overrides = {}) {
  const calls = { detect: 0, list: [], existing: 0, queued: [], published: [] };
  const raw = fixtureCandidates('prism');
  const api = createLauncherImport({
    detect: async () => { calls.detect++; return fixtureLaunchers; },
    list: async (...args) => { calls.list.push(args); return raw; },
    existing: async () => { calls.existing++; return [{ importLauncherKind: 'prism', importInstancePath: raw[0].instancePath }]; },
    enqueue: async (...args) => { calls.queued.push(args); },
    icon: (path) => `asset:${path}`,
    publish: (rows) => calls.published.push(rows),
    ...overrides,
  });
  return { api, calls, raw };
}

test('scan cache joins in-flight work, normalizes roots and separates launcher/root keys', async () => {
  const gate = deferred();
  let reads = 0;
  const { api } = setup({ list: async () => { reads++; return gate.promise; } });
  const first = api.loadCandidates('prism', ' /root ');
  expect(api.loadCandidates('prism', '/root')).toBe(first);
  gate.resolve(fixtureCandidates('prism'));
  await first;
  expect(api.loadCandidates('prism', '/root')).toBe(first);
  await api.loadCandidates('prism', '/other');
  await api.loadCandidates('modrinthApp', '/root');
  expect(reads).toBe(3);
});

test('failed scans retry; refresh joins discovery, retains all roots and invalidates scans', async () => {
  let reads = 0;
  const gate = deferred();
  const { api, calls } = setup({
    detect: () => gate.promise,
    list: async () => { if (++reads === 1) throw new Error('scan failed'); return []; },
  });
  await expect(api.loadCandidates('prism')).rejects.toThrow('scan failed');
  await api.loadCandidates('prism');
  const refreshing = api.refreshLaunchers();
  expect(api.refreshLaunchers()).toBe(refreshing);
  gate.resolve([{ kind: 'prism', detectedPaths: ['/a', '/b', '/a', ''] }]);
  await refreshing;
  expect(api.detectedLauncherPaths('prism')).toEqual(['/a', '/b']);
  expect(calls.published[0][0]).toMatchObject({ id: 'prism', path: '/a', icon: 'branding/launchers/prism-launcher' });
  await api.loadCandidates('prism');
  expect(reads).toBe(3);
});

test('candidate mapping preserves raw payload and matches persisted launcher AND instance path', async () => {
  const { api, raw } = setup();
  raw[0].iconPath = '/icon.png';
  const candidates = await api.loadCandidates('prism');
  expect(candidates[0]).toMatchObject({ key: raw[0].instancePath, minecraft: '1.21.1', loader: 'fabric', modCount: 32,
    alreadyImported: true, iconUrl: 'asset:/icon.png', lastPlayed: '2026-10-20T00:00:00.000Z' });
  expect(candidates[0].raw).toBe(raw[0]);
  expect(candidates[1].alreadyImported).toBe(false);
  expect((await api.loadCandidates('modrinthApp'))[0].alreadyImported).toBe(false);
});

test('bulk enqueue continues after failure, serializes overlapping batches and invalidates import flags', async () => {
  const gate = deferred();
  const seen = [];
  const existing = [];
  const { api, calls, raw } = setup({
    existing: async () => existing,
    enqueue: async (launcher, candidate, path) => {
      seen.push([candidate.key, candidate.raw, path]);
      if (seen.length === 1) await gate.promise;
      if (candidate.key.endsWith('/1')) throw new Error('disk unavailable');
      existing.push({ importLauncherKind: launcher, importInstancePath: candidate.key });
    },
  });
  const candidates = await api.loadCandidates('prism');
  const first = api.importMany('prism', candidates.slice(0, 3), ' /root ');
  const second = api.importMany('prism', candidates.slice(3));
  await Promise.resolve();
  expect(seen.length).toBe(1);
  gate.resolve();
  expect(await first).toEqual({ queued: 2, failed: [{ key: raw[1].instancePath, error: 'Error: disk unavailable' }] });
  expect(await second).toEqual({ queued: 1, failed: [] });
  expect(seen.map(([key]) => key)).toEqual(raw.map((row) => row.instancePath));
  expect(seen[0][1]).toBe(raw[0]);
  expect(seen[0][2]).toBe('/root');
  expect((await api.loadCandidates('prism'))[0].alreadyImported).toBe(true);
  expect(calls.list.length).toBe(2);
  expect(await api.importMany('prism', [])).toEqual({ queued: 0, failed: [] });
});

test('browser fixtures provide two launchers and eight candidates', () => {
  expect(fixtureLaunchers.length).toBe(2);
  expect(fixtureLaunchers.flatMap((row) => fixtureCandidates(row.kind)).length).toBe(8);
});
