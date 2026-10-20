import { expect, test } from 'bun:test';
import { createGameOptionsEditor, gameOptionItems } from '../src/features/instances/game-options';

const snapshot = (revision = 'r1', values = { gamma: '0.5' }) => ({ revision, exists: true, values });
const catalog = [{ key: 'gamma', id: 'brightness', category: 'video', kind: 'decimal', min: 0, max: 1, step: 0.01, unit: 'percent' }];
function harness(save = async (_id, _mode, revision, changes) => snapshot(revision + '+1', changes)) {
  const calls = [];
  const adapter = { catalog: async () => catalog, load: async () => snapshot(), save: async (...args) => { calls.push(args); return save(...args); } };
  return { editor: createGameOptionsEditor('42', 'options', adapter), calls, adapter };
}
test('instance options reuse typed metadata without sharing options and keybind values', () => {
  const saved = snapshot('r', { gamma: '0.5', 'key_key.forward': 'key.keyboard.w', 'mod.custom': 'true' });
  expect(gameOptionItems(saved, catalog, 'options').map((item) => item.key)).toEqual(['gamma', 'mod.custom']);
  expect(gameOptionItems(saved, catalog, 'options')[0].editor.unit).toBe('percent');
  expect(gameOptionItems(saved, catalog, 'keybinds')).toMatchObject([{ key: 'key_key.forward', group: 'movement' }]);
});
test('save sends only this instance draft with its disk revision, then uses the new revision', async () => {
  const { editor, calls } = harness(); await editor.load(); editor.change('gamma', '0.8');
  expect(editor.snapshot().values.gamma).toBe('0.5'); await editor.save();
  expect(calls).toEqual([['42', 'options', 'r1', { gamma: '0.8' }]]); expect(editor.changes()).toEqual({});
  editor.change('gamma', '0.9'); await editor.save(); expect(calls[1][2]).toBe('r1+1');
});
test('restoring the original value removes its pending change', async () => {
  const { editor, calls } = harness(); await editor.load(); editor.change('gamma', '0.8'); editor.change('gamma', '0.5'); await editor.save(); expect(calls).toEqual([]);
});
test('revision conflict retains draft and allows explicit reload before retry', async () => {
  const { editor, calls } = harness(async () => { throw new Error('Options changed on disk'); });
  await editor.load(); editor.change('gamma', '0.9'); await editor.save();
  expect(editor.error()).toContain('Options changed'); expect(editor.changes()).toEqual({ gamma: '0.9' }); expect(editor.snapshot().revision).toBe('r1');
  await editor.load(); expect(editor.error()).toBe(''); expect(editor.changes()).toEqual({}); expect(calls).toHaveLength(1);
});
test('duplicate saves are ignored while one write is pending', async () => {
  let resolve; const { editor, calls } = harness(() => new Promise((done) => { resolve = done; }));
  await editor.load(); editor.change('gamma', '0.8'); const pending = editor.save(); await editor.save(); expect(calls).toHaveLength(1);
  resolve(snapshot('r2', { gamma: '0.8' })); await pending; expect(editor.pending()).toBe(false);
});
test('failed loading can retry and disposed editors ignore late loads', async () => {
  let count = 0, resolve;
  const adapter = { catalog: async () => catalog, load: async () => { if (++count === 1) throw new Error('offline'); return new Promise((done) => { resolve = done; }); }, save: async () => snapshot() };
  const editor = createGameOptionsEditor('7', 'keybinds', adapter);
  await editor.load(); expect(editor.error()).toContain('offline'); expect(editor.snapshot()).toBeUndefined();
  const pending = editor.load(); editor.dispose(); resolve(snapshot()); await pending; expect(editor.snapshot()).toBeUndefined();
});
test('two editors keep drafts and instance identity separate', async () => {
  const { editor, adapter, calls } = harness(); const other = createGameOptionsEditor('99', 'keybinds', adapter);
  await Promise.all([editor.load(), other.load()]); editor.change('gamma', '0.9'); other.change('key_key.forward', 'key.keyboard.q'); await other.save();
  expect(calls[0]).toEqual(['99', 'keybinds', 'r1', { 'key_key.forward': 'key.keyboard.q' }]); expect(editor.changes()).toEqual({ gamma: '0.9' });
});
