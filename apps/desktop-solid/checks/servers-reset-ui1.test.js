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
    expect(initialChoice(catalog, { ...paper, software: 'forge' })).toEqual({ software: 'vanilla', minecraft: '1.21.1' });
    expect(initialChoice(catalog, null)).toEqual({ software: 'vanilla', minecraft: null });
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
