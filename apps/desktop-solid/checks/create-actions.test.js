import { expect, test } from 'bun:test';
import { createActionKey, requestCreateAction, takeCreateAction, openInstallSource, takeInstallSource, openResourceInstall, takeResourceInstall } from '../src/pages/create/install-navigation';

test('every create action gets a fresh owner, even when requested twice at the same route', () => {
  const keys = new Set([createActionKey()]);
  for (const action of ['new', 'methods', 'file', 'launchers', 'launchers']) {
    requestCreateAction(action); expect(keys.has(createActionKey())).toBe(false); keys.add(createActionKey());
    expect(takeCreateAction()).toBe(action); expect(takeCreateAction()).toBeUndefined();
  }
});
test('a new blank instance discards an unconsumed archive/resource handoff', () => {
  openInstallSource({ kind: 'file', value: 'pack.mrpack' }); requestCreateAction('new');
  expect(takeInstallSource()).toBeUndefined(); expect(takeCreateAction()).toBe('new');
  openResourceInstall({ project: { id: 'example' }, kind: 'mod' }); requestCreateAction('new');
  expect(takeResourceInstall()).toBeUndefined(); expect(takeCreateAction()).toBe('new');
});
test('provider/archive handoffs replace an unconsumed menu request', () => {
  requestCreateAction('file'); const before = createActionKey();
  const source = { kind: 'file', value: 'pack.mrpack' }; openInstallSource(source);
  expect(createActionKey()).not.toBe(before); expect(takeCreateAction()).toBeUndefined(); expect(takeInstallSource()).toBe(source); expect(takeInstallSource()).toBeUndefined();
  requestCreateAction('launchers'); const resource = { project: { id: 'example' }, kind: 'mod' }; openResourceInstall(resource);
  expect(takeCreateAction()).toBeUndefined(); expect(takeResourceInstall()).toBe(resource);
});
