// Pure rules behind the phase-two reset UI: the World page (D1), the Java picker (D5),
// raw protected-file editing (D4) and Access grouping (D7).
import { describe, expect, test } from 'bun:test';
import {
  SEED_MASK, datapackBlocker, datapackViews, dimensionViews, seedRevealed, seedText, splitLayout, toggleFeedback, toggleRejection, worldSize,
} from '../src/features/servers/world-model';

const caps = (granted) => ({ source: 'session', granted, refused: [] });
const running = { state: { phase: 'online' }, status: { state: 'running', generation: 'g1' }, capabilities: caps(['config.edit', 'console.write']) };

describe('[world] seed masking', () => {
  test('hidden by default; hover or focus reveals; a click pins it', () => {
    expect(seedRevealed({ pinned: false, hovering: false, privacy: false })).toBe(false);
    expect(seedRevealed({ pinned: false, hovering: true, privacy: false })).toBe(true);
    expect(seedRevealed({ pinned: true, hovering: false, privacy: false })).toBe(true);
  });
  test('privacy mode ignores hover; only a deliberate click reveals', () => {
    expect(seedRevealed({ pinned: false, hovering: true, privacy: true })).toBe(false);
    expect(seedRevealed({ pinned: true, hovering: false, privacy: true })).toBe(true);
  });
  test('the mask never leaks digits or length', () => {
    const short = seedText('42', false); const long = seedText('-4172144997902289642', false);
    expect(short).toEqual({ text: SEED_MASK, masked: true });
    expect(long.text).toBe(short.text);
    expect(SEED_MASK).not.toMatch(/\d/);
    expect(seedText('-4172144997902289642', true)).toEqual({ text: '-4172144997902289642', masked: false });
    expect(seedText(null, true)).toBeNull();
  });
});

describe('[world] size, dimensions and datapacks', () => {
  test('size is partial while the bounded scan is incomplete, unknown when null', () => {
    expect(worldSize({ sizeBytes: '2846072184', sizeComplete: true })).toEqual({ message: 'server-world.size', size: '2.7 GB' });
    expect(worldSize({ sizeBytes: '2846072184', sizeComplete: false }).message).toBe('server-world.size-partial');
    expect(worldSize({ sizeBytes: null, sizeComplete: false })).toBeNull();
  });
  test('overworld, nether and end always show in order; extra dimensions follow', () => {
    const views = dimensionViews([
      { id: 'end', present: true, folders: ['world_the_end/DIM1'], layout: 'split' },
      { id: 'mymod:moon', present: true, folders: ['world/dimensions/mymod/moon'], layout: 'nested' },
      { id: 'overworld', present: true, folders: ['world'], layout: 'nested' },
    ]);
    expect(views.map((view) => view.id)).toEqual(['overworld', 'nether', 'end', 'mymod:moon']);
    expect(views[1]).toMatchObject({ present: false, label: 'server-world.dimension-nether' });
    expect(views[2].split).toBe(true);
    expect(views[3].label).toBeNull();
  });
  test('split folders are explained only when a generated dimension is split', () => {
    expect(splitLayout([{ id: 'nether', present: true, folders: [], layout: 'split' }])).toBe(true);
    expect(splitLayout([{ id: 'nether', present: false, folders: [], layout: 'split' }])).toBe(false);
  });
  test('datapacks: built-in first, then by name, missing last; vanilla and missing packs never toggle', () => {
    const views = datapackViews([
      { id: 'file/zeta.zip', name: 'zeta.zip', kind: 'zip', path: 'world/datapacks/zeta.zip', enabled: false },
      { id: 'file/gone', name: 'gone', kind: 'missing', path: null, enabled: true },
      { id: 'file/alpha', name: 'alpha', kind: 'folder', path: 'world/datapacks/alpha', enabled: null },
      { id: 'vanilla', name: 'Vanilla', kind: 'builtin', path: null, enabled: true },
    ]);
    expect(views.map((view) => view.id)).toEqual(['vanilla', 'file/alpha', 'file/zeta.zip', 'file/gone']);
    expect(views.map((view) => view.state)).toEqual(['enabled', 'unknown', 'disabled', 'missing']);
    expect(views.map((view) => view.toggleable)).toEqual([false, true, true, false]);
  });
  test('toggling needs a running game and config.edit + console.write', () => {
    expect(datapackBlocker(running)).toBeNull();
    expect(datapackBlocker({ ...running, status: { state: 'stopped', generation: null } })).toBe('server-world.pack-needs-running');
    expect(datapackBlocker({ ...running, state: { phase: 'backoff' } })).toBe('server-world.pack-offline');
    expect(datapackBlocker({ ...running, capabilities: caps(['config.edit']) })).toBe('server-world.pack-no-permission');
  });
  test('toggle feedback follows the operation; completion only proves submission', () => {
    expect(toggleFeedback(undefined)).toEqual({ step: 'sending' });
    expect(toggleFeedback({ state: 'running', reconciling: false })).toEqual({ step: 'sent' });
    expect(toggleFeedback({ state: 'succeeded', reconciling: true })).toEqual({ step: 'sent' });
    expect(toggleFeedback({ state: 'succeeded', reconciling: false })).toEqual({ step: 'done' });
    expect(toggleFeedback({ state: 'failed', reconciling: false, outcome: 'stale_generation' })).toEqual({ step: 'failed', message: 'server-world.pack-restarted' });
    expect(toggleRejection('datapack_requires_running_game', 'conflict')).toBe('server-world.pack-needs-running');
    expect(toggleRejection(null, 'forbidden')).toBe('server-world.pack-no-permission');
  });
});

import {
  customPathProblem, downloadOffers, isJavaJob, javaCompatibility, javaGroups, javaJobMessage, javaRejection, runtimeFor,
} from '../src/features/servers/server-java-model';

const rt = (id, major, extra = {}) => ({ id, path: `/opt/${id}/bin/java`, version: `${major}.0.1`, major, vendor: 'Eclipse Adoptium', arch: 'amd64', managed: false, ...extra });

describe('[java] runtime list', () => {
  const inventory = {
    runtimes: [rt('a17', 17), rt('m21', 21, { managed: true }), rt('d21', 21, { vendor: 'Azul' }), rt('b25', 25)],
    selected: rt('d21', 21, { vendor: 'Azul' }), customPathsAllowed: false, managedMajors: [21],
  };
  test('groups per major, newest first; selected first, then managed, detected', () => {
    const groups = javaGroups(inventory, 21);
    expect(groups.map((group) => group.major)).toEqual([25, 21, 17]);
    const java21 = groups[1];
    expect(java21).toMatchObject({ inUse: true, required: true, missing: false });
    expect(java21.rows.map((row) => [row.runtime.id, row.source, row.selected])).toEqual([['d21', 'detected', true], ['m21', 'managed', false]]);
  });
  test('a required major with nothing installed gets an empty, downloadable group', () => {
    const groups = javaGroups({ ...inventory, runtimes: [rt('a17', 17)], selected: rt('a17', 17) }, 21);
    expect(groups.map((group) => [group.major, group.missing])).toEqual([[21, true], [17, false]]);
  });
  test('a selected runtime the agent did not list came from a custom path', () => {
    const custom = rt('C:/Java/approved/jdk/bin/java.exe', 21);
    const groups = javaGroups({ ...inventory, selected: custom }, null);
    expect(groups.find((group) => group.major === 21).rows[0]).toMatchObject({ source: 'custom', selected: true });
  });
  test('download offers: required first, then LTS lines not installed', () => {
    expect(downloadOffers({ ...inventory, runtimes: [rt('a17', 17)] }, 21)).toEqual([21, 25]);
    expect(downloadOffers(inventory, null)).toEqual([]);
  });
  test('runtimeFor prefers a managed runtime of the major', () => {
    expect(runtimeFor(inventory, 21).id).toBe('m21');
    expect(runtimeFor(inventory, 8)).toBeNull();
    expect(runtimeFor(undefined, 21)).toBeNull();
  });
});

describe('[java] compatibility, custom paths and jobs', () => {
  test('the plan decides; a missing verdict is unknown, never ok', () => {
    expect(javaCompatibility({ java: { major: 21 }, javaCompatible: true, selectedJavaMajor: 21, managedDownloadMajor: null }).state).toBe('ok');
    expect(javaCompatibility({ java: { major: 21 }, javaCompatible: false, selectedJavaMajor: 17, managedDownloadMajor: 21 }))
      .toEqual({ state: 'incompatible', required: 21, selected: 17, download: 21 });
    expect(javaCompatibility({ java: { major: 21 } })).toEqual({ state: 'unknown', required: 21, selected: null, download: null });
  });
  test('custom paths must be absolute and name the java program', () => {
    expect(customPathProblem('')).toBe('server-java.custom-empty');
    expect(customPathProblem('jdk/bin/java')).toBe('server-java.custom-absolute');
    expect(customPathProblem('C:/Java/../evil/java.exe')).toBe('server-java.custom-absolute');
    expect(customPathProblem('C:/Java/jdk/bin/javac.exe')).toBe('server-java.custom-executable');
    expect(customPathProblem(['C:', 'Java', 'jdk-21', 'bin', 'java.exe'].join('\\'))).toBeNull();
    expect(customPathProblem('/usr/lib/jvm/temurin-21/bin/java')).toBeNull();
  });
  test('java jobs are told apart from software jobs and have their own copy', () => {
    expect(isJavaJob({ kind: 'java_download' })).toBe(true);
    expect(isJavaJob({ kind: 'apply' })).toBe(false);
    expect(javaJobMessage({ kind: 'java_download', state: 'succeeded' })).toBe('server-java.download-done');
    expect(javaJobMessage({ kind: 'java_select', state: 'failed' })).toBe('server-java.select-failed');
    expect(javaJobMessage({ kind: 'java_select', state: 'staging' })).toBe('server-java.selecting');
    expect(javaRejection('conflict', 'software_state_unavailable')).toBe('server-java.stop-first');
    expect(javaRejection('forbidden', null)).toBe('server-java.custom-refused');
  });
});
