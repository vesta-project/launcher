import { expect, test } from 'bun:test';
import { displayIdentity, recoverBundledIdentities } from '../src/features/servers/content-recovery.ts';

const item = (path, extra = {}) => ({ path, size: '1024', kind: 'mod', modpackOwned: true, provider: null, displayProvider: null, pending: null, ...extra });

test('version display can use recorded identity and prefers verified identity', () => {
  const recorded = { provider: 'modrinth', projectId: 'old', versionId: 'old-version' };
  const verified = { provider: 'modrinth', projectId: 'new', versionId: 'new-version' };
  expect(displayIdentity(item('mods/a.jar', { displayProvider: recorded }))).toBe(recorded);
  expect(displayIdentity(item('mods/a.jar', { provider: verified, displayProvider: recorded }))).toBe(verified);
  expect(displayIdentity(item('mods/a.jar'))).toBeNull();
});

test('recovery is bounded, skips known and unrelated files, and stops admitting work on disposal', async () => {
  const items = [item('mods/a.jar'), item('mods/b.jar'), item('mods/c.jar'), item('mods/known.jar', { displayProvider: {} }), item('mods/custom.jar', { modpackOwned: false })];
  const attempted = new Set();
  const calls = [], replies = [];
  let active = true;
  const identify = entry => { calls.push(entry.path); return new Promise(resolve => replies.push(resolve)); };
  const recovery = recoverBundledIdentities(items, attempted, () => active, identify);
  expect(calls).toEqual(['mods/a.jar', 'mods/b.jar']);
  active = false;
  replies.forEach(resolve => resolve(true));
  expect(await recovery).toBe(true);
  expect(calls).toHaveLength(2);
  active = true;
  expect(await recoverBundledIdentities(items, attempted, () => active, async entry => { calls.push(entry.path); return null; })).toBe(false);
  expect(calls).toEqual(['mods/a.jar', 'mods/b.jar', 'mods/c.jar']);
  await recoverBundledIdentities(items, attempted, () => active, async entry => { calls.push(entry.path); return null; });
  expect(calls).toHaveLength(3);
});

test('a successful identification does not skip other queued files', async () => {
  const calls = [];
  expect(await recoverBundledIdentities([item('mods/a.jar'), item('mods/b.jar'), item('mods/c.jar')], new Set(), () => true,
    async entry => { calls.push(entry.path); return {}; })).toBe(true);
  expect(calls).toEqual(['mods/a.jar', 'mods/b.jar', 'mods/c.jar']);
});

test('recovery honors the server size limit and rejects unknown sizes', async () => {
  const calls = [];
  await recoverBundledIdentities([item('mods/limit.jar', { size: '16777216' }), item('mods/large.jar', { size: '16777217' }),
    item('mods/unknown.jar', { size: 'unknown' }), item('mods/huge.jar', { size: '9007199254740993' })], new Set(), () => true,
  async entry => { calls.push(entry.path); return null; });
  expect(calls).toEqual(['mods/limit.jar']);
});
