// Pure rules behind the reset-plan UI work: the freshness rule (D9), the inline software
// change flow (D2) and the drag-and-drop upload plan (D10).
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SOFTWARE_IDS } from '../src/features/servers/hosting-native';
import { STATUS_INTERVAL_MS, freshnessVisible, minecraftFactNow } from '../src/features/servers/model';
import {
  changeBlocker, choiceState, initialChoice, keepMinecraft, latestVersionLabel, softwareIcon, softwareVersionKind, softwareVersionText,
} from '../src/features/servers/software-flow';
import { keepBothName, planUploads, uploadConflict, uploadLabel } from '../src/features/servers/files-model';

const status = { state: 'running', readiness: 'ready', lifecycle: 'running', playerCount: 0, playerCountKnown: true, playerCountObservedAtMs: null };
const snapshot = (phase, observedAtMs) => ({ state: { phase }, status, statusObservedAtMs: observedAtMs });

describe('[freshness] "Updated N ago" only while disrupted or stale', () => {
  test('a live, current value shows no age', () => {
    expect(freshnessVisible('online', 1_000, 1_000)).toBe(false);
    expect(freshnessVisible('online', 0, 2 * STATUS_INTERVAL_MS)).toBe(false);
  });

  test('a connected value older than twice the expected interval is stale', () => {
    expect(freshnessVisible('online', 0, 2 * STATUS_INTERVAL_MS + 1)).toBe(true);
    expect(freshnessVisible('online', 0, 5_000, 2_000)).toBe(true);
  });

  test('any disruption shows when it was last seen, however recent', () => {
    for (const phase of ['connecting', 'backoff', 'unreachable', 'disconnected']) expect(freshnessVisible(phase, 1_000, 1_000)).toBe(true);
  });

  test('nothing observed yet means nothing to date', () => {
    expect(freshnessVisible('unreachable', null, 1_000)).toBe(false);
  });

  test('the header keeps its tone while stale but connected, and drops it while disconnected', () => {
    expect(minecraftFactNow(snapshot('online', 0), 5_000).seen).toBeUndefined();
    expect(minecraftFactNow(snapshot('online', 0), 60_000)).toMatchObject({ tone: 'success', seen: { message: 'servers.age.minutes', count: 1 } });
    expect(minecraftFactNow(snapshot('backoff', 0), 5_000)).toMatchObject({ tone: 'neutral', seen: { message: 'servers.age.seconds', count: 5 } });
  });
});

const entry = (software, ok = true) => ({ software, automaticBackend: ok, unavailableReason: ok ? null : 'provider_not_implemented', source: '', licence: '', eula: '', caution: null });
const catalog = [entry('vanilla'), entry('paper'), entry('fabric'), entry('forge', false)];
const paper = { software: 'paper', version: '1.21.1', build: 130, installationId: 'x', javaMajor: 21 };

describe('[software] inline change flow', () => {
  test('starts from what runs now, or the first software that can be set up here', () => {
    expect(initialChoice(catalog, paper)).toEqual({ software: 'paper', minecraft: '1.21.1' });
    expect(initialChoice(catalog, { ...paper, software: 'forge' })).toEqual({ software: 'forge', minecraft: '1.21.1' });
    expect(initialChoice(catalog, null)).toEqual({ software: 'vanilla', minecraft: null });
    expect(initialChoice(catalog, null, '26.3')).toEqual({ software: 'vanilla', minecraft: '26.3' });
    expect(initialChoice([entry('forge', false)], paper).software).toBeNull();
  });

  test('keeps the Minecraft version across software when offered, else the newest', () => {
    expect(keepMinecraft(['1.21.4', '1.21.1'], '1.21.1')).toBe('1.21.1');
    expect(keepMinecraft(['1.21.4', '1.20.6'], '1.21.1')).toBe('1.21.4');
    expect(keepMinecraft([], '1.21.1')).toBeNull();
    expect(keepMinecraft(undefined, '1.21.1')).toBeNull();
  });

  test('knows when the choice changes anything', () => {
    expect(choiceState({ software: 'paper', minecraft: null }, paper)).toBe('incomplete');
    expect(choiceState({ software: 'paper', minecraft: '1.21.1' }, paper)).toBe('same');
    expect(choiceState({ software: 'paper', minecraft: '1.21.4' }, paper)).toBe('changed');
    expect(choiceState({ software: 'purpur', minecraft: '1.21.1' }, paper)).toBe('changed');
    expect(choiceState({ software: 'vanilla', minecraft: '1.21.1' }, null)).toBe('changed');
  });

  test('the software version is a build, a loader, or nothing beyond Minecraft', () => {
    expect(softwareVersionKind('paper')).toBe('build');
    expect(softwareVersionKind('fabric')).toBe('loader');
    expect(softwareVersionKind('vanilla')).toBeNull();
    expect(latestVersionLabel('purpur')).toBe('server-hosting.latest-build');
    expect(latestVersionLabel('quilt')).toBe('server-hosting.latest-loader');
    expect(latestVersionLabel('vanilla')).toBeNull();
    expect(softwareVersionText(paper)).toBe('build 130');
    expect(softwareVersionText({ ...paper, build: null, loaderVersion: '0.16.9' })).toBe('loader 0.16.9');
    expect(softwareVersionText({ ...paper, software: 'vanilla', build: null })).toBeNull();
  });

  test('review waits for a stopped server; recovery and running jobs come first', () => {
    const base = { available: true, recoveryRequired: false, stopped: true, jobRunning: false };
    expect(changeBlocker(base)).toBeNull();
    expect(changeBlocker({ ...base, stopped: false })).toBe('server-hosting.stop-to-change');
    expect(changeBlocker({ ...base, stopped: false, jobRunning: true })).toBe('server-hosting.reason-busy');
    expect(changeBlocker({ ...base, recoveryRequired: true, stopped: false })).toBe('server-hosting.recovery-banner');
    expect(changeBlocker({ ...base, available: false })).toBe('server-hosting.software-unavailable');
  });

  test('every software has a bundled mark', () => {
    for (const id of SOFTWARE_IDS) expect(existsSync(join(import.meta.dir, '..', 'src', 'assets', `${softwareIcon[id]}.svg`)), id).toBe(true);
  });
});

describe('[files] dropped files become an upload plan', () => {
  const siblings = [
    { name: 'mods', kind: 'directory', size: '0', modifiedAtMs: null },
    { name: 'start.sh', kind: 'file', size: '80', modifiedAtMs: null },
    { name: 'start (2).sh', kind: 'file', size: '80', modifiedAtMs: null },
  ];
  const file = (localId, name, folder, size = '1000') => ({ localId, name, size, ...(folder ? { folder } : {}) });

  test('loose files that collide wait for a choice; folder contents never collide with the listing', () => {
    expect(uploadConflict(file('a', 'START.SH'), siblings)).toBe('file');
    expect(uploadConflict(file('a', 'mods'), siblings)).toBe('directory');
    expect(uploadConflict(file('a', 'start.sh', 'plugins'), siblings)).toBeNull();
    const plan = planUploads('', [file('a', 'start.sh'), file('b', 'welcome.txt')], siblings, {});
    expect(plan.unresolved).toEqual(['a']);
    expect(plan.uploads).toEqual([{ localId: 'b', path: 'welcome.txt', mode: 'create' }]);
  });

  test('replace trashes then creates; keep both picks a free name; skip drops the file', () => {
    const files = [file('a', 'start.sh'), file('b', 'start.sh', null, '5'), file('c', 'start.sh')];
    // Same-name files in one drop are separate candidates; each decides for itself.
    const plan = planUploads('', files, siblings, { a: 'replace', b: 'keep-both', c: 'skip' });
    expect(plan.uploads).toEqual([
      { localId: 'a', path: 'start.sh', mode: 'replace' },
      { localId: 'b', path: 'start (3).sh', mode: 'create' },
    ]);
    expect(plan.skipped).toEqual(['c']);
    expect(plan.unresolved).toEqual([]);
    expect(keepBothName('notes', new Set(['notes', 'notes (2)']))).toBe('notes (3)');
    expect(keepBothName('.env', new Set(['.env']))).toBe('.env (2)');
  });

  test('a folder can only be kept twice or skipped, never replaced by a file', () => {
    expect(planUploads('', [file('a', 'mods')], siblings, { a: 'replace' }).unresolved).toEqual(['a']);
    expect(planUploads('', [file('a', 'mods')], siblings, { a: 'keep-both' }).uploads[0].path).toBe('mods (2)');
  });

  test('dropped folders are created parents first, merging into folders that exist', () => {
    const plan = planUploads('world', [
      file('a', 'config.yml', 'plugins/LuckPerms'),
      file('b', 'LuckPerms.jar', 'plugins'),
      file('c', 'x.jar', 'mods/extra'),
    ], [{ name: 'mods', kind: 'directory', size: '0', modifiedAtMs: null }], {});
    expect(plan.folders).toEqual(['world/plugins', 'world/mods/extra', 'world/plugins/LuckPerms']);
    expect(plan.uploads.map((entry) => entry.path)).toEqual(['world/plugins/LuckPerms/config.yml', 'world/plugins/LuckPerms.jar', 'world/mods/extra/x.jar']);
    expect(uploadLabel(file('a', 'config.yml', 'plugins/LuckPerms'))).toBe('plugins/LuckPerms/config.yml');
  });

  test('the usual upload rules still apply, to the whole path', () => {
    expect(planUploads('', [], siblings, {}).problem).toBe('server-files.upload.nothing');
    expect(planUploads('', [file('a', 'ops.json')], siblings, {}).problem).toBe('server-files.protected-name');
    expect(planUploads('', [file('a', 'x.txt', 'bad:dir')], siblings, {}).problem).toBe('server-files.upload.bad-name');
    expect(planUploads('', [file('a', 'big.bin', null, String(17 * 1_048_576))], siblings, {}).problem).toBe('server-files.upload.too-large');
    // Skipping a big file brings the rest back under the limit; skipping everything is simply nothing to do.
    expect(planUploads('', [file('a', 'start.sh', null, String(17 * 1_048_576)), file('b', 'ok.txt')], siblings, { a: 'skip' }).problem).toBeNull();
    expect(planUploads('', [file('a', 'start.sh')], siblings, { a: 'skip' })).toMatchObject({ problem: null, uploads: [] });
  });
});
