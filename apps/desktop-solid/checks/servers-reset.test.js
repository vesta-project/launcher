import { test, expect } from 'bun:test';
import { createFixtureServers } from '../src/features/servers/fixtures';
import { lifecycleControls } from '../src/features/servers/model';
import { fileProtection } from '../src/features/servers/native-files';
const ID = 'fixture-survival';
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));

test('protected files need a payload-bound confirmation; private paths remain hidden', async () => {
  const api = createFixtureServers({ latencyMs: 0 }); const before = await api.fileReadText(ID, 'ops.json');
  const pending = await api.fileWriteProtected(ID, 'ops.json', '[]', before.sha256, null, 'raw-1');
  expect(pending.kind).toBe('awaitingConfirmation');
  expect((await api.fileReadText(ID, 'ops.json')).sha256).toBe(before.sha256);
  await expect(api.fileWriteProtected(ID, 'ops.json', '[{}]', before.sha256, pending.confirmationToken, 'raw-1')).rejects.toMatchObject({ code: 'confirmation_expired' });
  const done = await api.fileWriteProtected(ID, 'ops.json', '[]', before.sha256, pending.confirmationToken, 'raw-1');
  expect(done.kind).toBe('applied');
  expect(await api.fileWriteProtected(ID, 'ops.json', '[]', before.sha256, pending.confirmationToken, 'raw-1')).toEqual(done);
  expect(fileProtection('.vesta/private')).toBe('hidden'); expect(fileProtection('ops.json')).toBe('confirm_edit');
  await expect(api.fileReadText('fixture-creative', 'ops.json')).rejects.toMatchObject({ code: 'forbidden' });
});

test('lifecycle controls expose Sleep / Wake and preserve Stop in the menu', async () => {
  const api = createFixtureServers({ latencyMs: 0 }); const snapshot = await api.snapshot(ID);
  snapshot.status.sleepAvailable = true;
  expect(lifecycleControls(snapshot)).toMatchObject({ primary: 'sleep', stop: true });
  snapshot.status = { ...snapshot.status, state: 'stopped', generation: null, lifecycle: 'sleeping' };
  expect(lifecycleControls(snapshot)).toMatchObject({ primary: 'wake', stop: true });
  snapshot.status.lifecycle = 'offline'; expect(lifecycleControls(snapshot).primary).toBe('start');
});

test('datapack toggles use the current generation and retain one intent', async () => {
  const api = createFixtureServers({ latencyMs: 0 }); const snapshot = await api.snapshot(ID); const generation = snapshot.status.generation;
  const first = await api.worldDatapackToggle(ID, 'file/seasonal', true, generation, 'pack-1');
  expect((await api.worldDatapackToggle(ID, 'file/seasonal', true, generation, 'pack-1')).operationId).toBe(first.operationId);
  await expect(api.worldDatapackToggle(ID, 'file/seasonal', true, 'wrong', 'pack-2')).rejects.toMatchObject({ code: 'conflict' });
  await settle(650); expect((await api.world(ID)).datapacks.find(p => p.id === 'file/seasonal').enabled).toBe(true);
});

test('Java selection is owner-only and stopped; incompatible plans offer a managed major', async () => {
  const api = createFixtureServers({ latencyMs: 0 }); const inventory = await api.javaInventory(ID);
  expect(inventory.runtimes.map(r => r.major)).toEqual([17, 21, 25]);
  await expect(api.javaInventory('fixture-creative')).rejects.toMatchObject({ code: 'forbidden' });
  await expect(api.javaSelect(ID, 'java-17', null, 'java-running')).rejects.toMatchObject({ code: 'conflict' });
  const snapshot = await api.snapshot(ID); await api.lifecycle(ID, 'stop', snapshot.status.generation, 'stop-java'); await settle(3550);
  await expect(api.javaSelect(ID, null, 'C:/outside/java.exe', 'java-custom')).rejects.toMatchObject({ code: 'forbidden' });
  await api.javaSelect(ID, 'java-17', null, 'java-select'); await settle(4850);
  const plan = await api.softwarePlan(ID, { software: 'paper', version: '1.21.4' });
  expect(plan.javaCompatible).toBe(false); expect(plan.managedDownloadMajor).toBe(21);
  await expect(api.softwareApply(ID, plan.planId, true, true, 'incompatible')).rejects.toMatchObject({ code: 'confirmation_expired' });
}, 12000);

test('history includes raw and five-minute series, gaps, explicit unknowns, and no-TPS servers', async () => {
  const api = createFixtureServers({ latencyMs: 0 }); const to = Date.now();
  const request = { from: to - 3600000, to, resolution: 'raw', maxPoints: 2000, series: ['tps', 'game_cpu_percent', 'game_memory_bytes', 'players_online'] };
  const raw = await api.metricsHistory(ID, request); expect(raw.gaps.some(Boolean)).toBe(true); expect(raw.series.tps.avg.some(v => v === null)).toBe(true);
  const aggregates = await api.metricsHistory(ID, { ...request, resolution: '5m' }); expect(aggregates.bucketMillis).toBe(300000); expect(aggregates.series.game_cpu_percent.knownCount.some(n => n > 1)).toBe(true);
  const noTps = await api.metricsHistory('fixture-creative', request); expect(noTps.series.tps.avg.every(v => v === null)).toBe(true); expect(noTps.tickSource.every(v => v === null)).toBe(true);
});
