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
