import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createFluentBundle, formatLocalizedMessage } from '../src/localization/catalog';
import { formatActivityText, formatActivityBytes } from '../src/features/activity/activity-text';
import { ActivityLedger, selectPill } from '../src/features/activity/activity-model';

const bundle = createFluentBundle('en', [readFileSync(new URL('../src/localization/locales/en/activity.ftl', import.meta.url), 'utf8')]);
const t = (id, args) => formatLocalizedMessage(bundle, bundle, id, args).replace(/[\u2068\u2069]/g, '');
const format = (patch = {}) => formatActivityText({ kind: 'instance_install', title: 'Legacy title', step: '/private/raw-file.jar', subject: { id: '42', name: 'Fabulously Optimized' }, stage: 'downloading_libraries', ...patch }, t, 'en');

const titles = {
  instance_install: 'Installing Fabulously Optimized', modpack_install: 'Installing Fabulously Optimized',
  modpack_update: 'Updating Fabulously Optimized', modpack_export: 'Exporting Fabulously Optimized',
  resource_install: 'Installing Fabulously Optimized', java_download: 'Java Fabulously Optimized',
  launcher_import: 'Importing Fabulously Optimized', import_resync: 'Syncing resources for Fabulously Optimized',
  resource_enrichment: 'Matching resources for Fabulously Optimized', manifest_refresh: 'Refreshing game versions',
  profile_sync: 'Syncing profiles', instance_duplicate: 'Duplicating Fabulously Optimized',
  instance_reset: 'Resetting Fabulously Optimized', instance_repair: 'Repairing Fabulously Optimized',
  instance_delete: 'Deleting Fabulously Optimized', world_transfer: 'Copying Fabulously Optimized',
  drop_apply: 'Adding resources to Fabulously Optimized',
};
for (const [kind, title] of Object.entries(titles)) {
  test(`structured ${kind} uses English Fluent copy and safe stage text`, () => {
    expect(format({ kind })).toEqual({ title, subtitle: undefined, step: 'Downloading libraries' });
  });
}
test('unknown and legacy kinds preserve legacy text', () => {
  for (const kind of ['future_task', 'task', 'background', 'constructor', '__proto__'])
    expect(format({ kind, subtitle: 'Legacy subtitle' })).toEqual({ title: 'Legacy title', subtitle: 'Legacy subtitle', step: '/private/raw-file.jar' });
});
test('separates byte progress from item counts and supports unknown totals', () => {
  expect(format({ items: { done: 47, total: 112 } }).step).toBe('Downloading libraries · 47/112');
  expect(format({ bytes: { done: 12_000_000, total: 38_000_000 }, items: { done: 1, total: 3 } }).step).toBe('Downloading libraries · 12 MB / 38 MB');
  expect(format({ bytes: { done: 1200 } }).step).toBe('Downloading libraries · 1.2 kB');
  expect(format({ items: { done: 47 } }).step).toBe('Downloading libraries · 47');
  expect(format({ items: { done: 0, total: 0 } }).step).toBe('Downloading libraries · 0/0');
  expect(formatActivityBytes(-1, 'en')).toBe('0 byte');
});
test('subjects, duplicate source and world transfer mode are independent of legacy prose', () => {
  expect(format({ kind: 'java_download', subject: { name: '21' } }).title).toBe('Java 21');
  expect(format({ kind: 'instance_duplicate', source: { name: 'Original' } }).subtitle).toBe('From Original');
  expect(format({ kind: 'world_transfer', mode: 'move', source: { name: 'Source' }, destination: { name: 'Destination' } })).toMatchObject({ title: 'Moving Fabulously Optimized', subtitle: 'Source → Destination' });
  expect(format({ subject: { name: '/private/secret' }, stage: 'unknown-stage' })).toMatchObject({ title: 'Installing instance', step: t('activity.working') });
});
test('structured foreground and background visibility is independent of kind', () => {
  const ledger = new ActivityLedger();
  ledger.upsert({ id: 'drop', kind: 'drop_apply', visibility: 'foreground', state: 'running', title: 'Adding resources' }, 0);
  expect(selectPill(ledger.rows, 0).state).toBe('running');
  ledger.upsert({ id: 'drop', visibility: 'background' }, 0);
  expect(selectPill(ledger.rows, 0).state).toBe('idle');
  expect(selectPill(ledger.rows, 1500).state).toBe('quiet');
});
test('overall remains monotonic across stages, completes only on success, resets on retry', () => {
  const ledger = new ActivityLedger();
  ledger.upsert({ id: 'install', attempt: 'one', kind: 'instance_install', state: 'running', overallProgress: 0.7, progress: 1 }, 0);
  ledger.upsert({ id: 'install', stage: 'downloading_assets', overallProgress: 0.2, progress: 0 }, 1);
  expect(ledger.rows[0].overallProgress).toBe(0.7);
  expect(ledger.rows[0].progress).toBe(0);
  ledger.upsert({ id: 'install', state: 'done' }, 2);
  expect(ledger.rows[0].overallProgress).toBe(1);
  ledger.upsert({ id: 'install', attempt: 'two', state: 'queued', overallProgress: 0 }, 3);
  expect(ledger.rows[0].overallProgress).toBe(0);
});
