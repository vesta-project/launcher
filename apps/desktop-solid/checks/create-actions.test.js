import { expect, test } from 'bun:test';
import { createActionKey, requestCreateAction, takeCreateAction, openInstallSource, takeInstallSource, openResourceInstall, takeResourceInstall } from '../src/pages/create/install-navigation';
import { closeImport, importRequest } from '../src/features/installation/import-request';

test('a new instance gets a fresh form each time, even when requested twice at the same route', () => {
  const keys = new Set([createActionKey()]);
  for (let i = 0; i < 2; i++) {
    requestCreateAction('new'); expect(keys.has(createActionKey())).toBe(false); keys.add(createActionKey());
    expect(takeCreateAction()).toBe('new'); expect(takeCreateAction()).toBeUndefined();
  }
});
test('importing opens the dialog over the current page instead of the install form', () => {
  const before = createActionKey();
  for (const action of ['methods', 'file', 'launchers']) {
    requestCreateAction(action);
    expect(importRequest()?.step).toBe(action);
    expect(takeCreateAction()).toBeUndefined();
  }
  expect(createActionKey()).toBe(before);
  closeImport(); expect(importRequest()).toBeNull();
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
