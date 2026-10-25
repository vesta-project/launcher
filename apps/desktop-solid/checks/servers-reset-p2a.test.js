// Phase 2 reset UI rules: the Sleep/Wake/Stop/Start lifecycle (D3) and the Overview
// graphs (D9). Pure projections only; the pages render what these return.
import { describe, expect, test } from 'bun:test';
import { capabilitiesForRole } from '../src/features/servers/capabilities';
import { lifecycleControls, quickAction, statusDot } from '../src/features/servers/model';
import {
  agentStartAllowed, agentStartChoice, liveBlocker, remainingSeconds, sleepBlockerCopy, sleepingMessage,
} from '../src/features/servers/sleep-model';
import {
  RANGE_SPEC, graphDomain, graphPoints, historyPoints, historyRequest, latestKnown, livePoints, maxStepMs, metricPresent, nearestIndex,
  niceCeil, segments, seriesStats,
} from '../src/features/servers/metrics-model';

const status = (patch = {}) => ({
  state: 'running', lifecycle: 'online', generation: 'g'.repeat(32), playerCount: 0, playerCountKnown: true, playerCountObservedAtMs: 1_000,
  uptimeSeconds: '60', readiness: 'ready', readinessReason: null, readinessEvidence: 'log_and_probe', supervision: 'separate', supervisor: null,
  sleepAvailable: true, ...patch,
});
const snapshot = (statusPatch = {}, patch = {}) => ({
  connection: { id: 'c1', name: 'Test', serverId: 's' },
  state: { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
  status: statusPatch === null ? null : status(statusPatch),
  statusObservedAtMs: 1_000,
  capabilities: { source: 'role_defaults', granted: capabilitiesForRole('owner'), refused: [] },
  ...patch,
});

describe('[lifecycle] AMP model: Sleep / Wake / Stop / Start', () => {
  test('running with sleep available: Sleep primary, Restart beside it, Stop in the menu', () => {
    expect(lifecycleControls(snapshot())).toEqual({ primary: 'sleep', restart: true, stop: true, progress: null, blocked: null });
  });

  test('running without sleep: Stop is the primary and the menu has no second Stop', () => {
    for (const sleepAvailable of [false, null, undefined]) {
      expect(lifecycleControls(snapshot({ sleepAvailable }))).toMatchObject({ primary: 'stop', restart: true, stop: false });
    }
  });

  test('sleeping: Wake primary, Stop in the menu, no Restart', () => {
    const sleeping = snapshot({ state: 'stopped', lifecycle: 'sleeping', generation: null, readiness: 'stopped' });
    expect(lifecycleControls(sleeping)).toEqual({ primary: 'wake', restart: false, stop: true, progress: null, blocked: null });
    expect(statusDot(sleeping)).toBe('sleeping');
  });

  test('explicitly stopped: Start only; wake never applies', () => {
    const stopped = snapshot({ state: 'stopped', lifecycle: 'offline', generation: null, readiness: 'stopped' });
    expect(lifecycleControls(stopped)).toEqual({ primary: 'start', restart: false, stop: false, progress: null, blocked: null });
    expect(statusDot(stopped)).toBe('stopped');
  });

  test('waking before the process exists shows progress and nothing to press', () => {
    const waking = snapshot({ state: 'stopped', lifecycle: 'waking', generation: null, readiness: 'stopped' });
    expect(lifecycleControls(waking)).toEqual({ primary: null, restart: false, stop: false, progress: 'waking', blocked: null });
    expect(statusDot(waking)).toBe('starting');
  });

  test('a run still coming up offers Stop, never Sleep or Restart', () => {
    expect(lifecycleControls(snapshot({ lifecycle: 'waking', readiness: 'starting' }))).toMatchObject({ primary: 'stop', progress: 'waking', restart: false, stop: false });
    expect(lifecycleControls(snapshot({ readiness: 'starting' }))).toMatchObject({ primary: 'stop', progress: 'starting', restart: false });
  });

  test('stopping keeps Force kill; permissions still gate every action', () => {
    expect(lifecycleControls(snapshot({ state: 'stopping' }))).toMatchObject({ primary: 'kill', stop: false });
    const viewer = { source: 'role_defaults', granted: capabilitiesForRole('viewer'), refused: [] };
    expect(lifecycleControls(snapshot({}, { capabilities: viewer }))).toMatchObject({ primary: null, stop: false, blocked: 'servers.lifecycle.not-allowed' });
    const startOnly = { source: 'session', granted: ['lifecycle.start'], refused: [] };
    expect(lifecycleControls(snapshot({ state: 'stopped', lifecycle: 'sleeping', generation: null }, { capabilities: startOnly }))).toMatchObject({ primary: 'wake', stop: false });
  });

  test('cards and pins offer the same primary, never Force kill', () => {
    expect(quickAction(snapshot())).toBe('sleep');
    expect(quickAction(snapshot({ state: 'stopped', lifecycle: 'sleeping', generation: null }))).toBe('wake');
    expect(quickAction(snapshot({ state: 'stopping' }))).toBeNull();
  });
});

describe('[sleep] plain-language copy', () => {
  test('a sleeping server says whether joins wake it', () => {
    expect(sleepingMessage({ offlineStatus: true, wakeOnJoin: true })).toBe('servers.minecraft.sleeping-wakes');
    expect(sleepingMessage({ offlineStatus: true, wakeOnJoin: false })).toBe('servers.minecraft.sleeping');
    expect(sleepingMessage({ offlineStatus: false, wakeOnJoin: true })).toBe('servers.minecraft.sleeping');
    expect(sleepingMessage(undefined)).toBe('servers.minecraft.sleeping');
  });

  test('each blocker maps to a calm explanation; disabled and unknown say nothing', () => {
    const cases = {
      not_ready: 'servers.sleep-blocker.not-ready', players_online: 'servers.sleep-blocker.players-online',
      player_count_unknown: 'servers.sleep-blocker.player-count-unknown', operation_in_progress: 'servers.sleep-blocker.operation',
      hold: 'servers.sleep-blocker.hold', authority_unavailable: 'servers.sleep-blocker.authority',
    };
    for (const [reason, message] of Object.entries(cases)) expect(sleepBlockerCopy({ reason }, 'online')).toEqual({ message, kind: 'waiting' });
    expect(sleepBlockerCopy({ reason: 'disabled' }, 'online')).toBeNull();
    expect(sleepBlockerCopy(null, 'online')).toBeNull();
    expect(sleepBlockerCopy({ reason: 'not_ready' }, 'sleeping')).toEqual({ message: 'servers.sleep-blocker.asleep', kind: 'asleep' });
  });

  test('countdowns tick locally and switch to minutes for long waits', () => {
    expect(sleepBlockerCopy({ reason: 'counting_down', remainingSeconds: 40 }, 'online', 10_000, 10_000)).toEqual({ message: 'servers.sleep-blocker.counting-seconds', args: { count: 40 }, kind: 'counting' });
    expect(sleepBlockerCopy({ reason: 'counting_down', remainingSeconds: 40 }, 'online', 10_000, 25_000).args).toEqual({ count: 25 });
    expect(sleepBlockerCopy({ reason: 'counting_down', remainingSeconds: 600 }, 'online', 0, 0)).toMatchObject({ message: 'servers.sleep-blocker.counting-minutes', args: { count: 10 } });
    expect(sleepBlockerCopy({ reason: 'warning_sent', remainingSeconds: 20 }, 'online', 0, 0).message).toBe('servers.sleep-blocker.warned-seconds');
    expect(remainingSeconds(5, 0, 60_000)).toBe(0);
  });

  test('a stale "disabled" status blocker defers to the policy read once sleep is on', () => {
    expect(liveBlocker({ reason: 'disabled' }, { reason: 'players_online' }, true)).toEqual({ reason: 'players_online' });
    expect(liveBlocker({ reason: 'hold' }, { reason: 'players_online' }, true)).toEqual({ reason: 'hold' });
    expect(liveBlocker(undefined, null, true)).toBeNull();
  });

  test('startup choice shows the saved value, else the inherited one; sleep needs the responder', () => {
    expect(agentStartChoice({ onAgentStart: 'start' }, { onAgentStart: 'sleep' })).toBe('start');
    expect(agentStartChoice({ onAgentStart: null }, { onAgentStart: 'sleep' })).toBe('sleep');
    expect(agentStartChoice(undefined, null)).toBe('stay_stopped');
    expect(agentStartAllowed('sleep', { offlineStatus: false })).toBe(false);
    expect(agentStartAllowed('sleep', { offlineStatus: true })).toBe(true);
    expect(agentStartAllowed('start', { offlineStatus: false })).toBe(true);
  });
});

const column = (avg) => ({ avg, min: avg.map((v) => (v === null ? null : v - 1)), max: avg.map((v) => (v === null ? null : v + 1)), knownCount: avg.map(() => 1), unknownCount: avg.map(() => 0) });
const history = (patch = {}) => ({
  timestamps: [0, 10_000, 20_000, 30_000], gaps: [false, false, true, false], tickSource: [null, null, null, null],
  series: { game_cpu_percent: column([10, 20, 30, 40]), players_online: column([null, null, null, null]) },
  resolution: 'raw', bucketMillis: 10_000, cursor: '30000', retentionGap: false, ...patch,
});
const sample = (atMs, patch = {}) => ({ atMs, cpuPercent: 50, memoryUsedBytes: '1073741824', memoryMaxBytes: '4294967296', tps: null, mspt: null, playersOnline: 2, ...patch });

describe('[graphs] series from history plus live samples', () => {
  test('requests ask for every metric over the whole window at the range resolution', () => {
    expect(historyRequest('15m', 1_000_000)).toMatchObject({ from: 100_000, to: 1_000_000, resolution: 'raw', maxPoints: 2000 });
    expect(historyRequest('24h', 100_000_000)).toMatchObject({ from: 100_000_000 - 86_400_000, resolution: '5m' });
    expect(historyRequest('1h', 0).series).toEqual(['tps', 'game_cpu_percent', 'game_memory_bytes', 'players_online']);
  });

  test('gap rows read as unknown, and a missing series is not a graph', () => {
    const points = historyPoints(history(), 'cpu');
    expect(points.map((p) => p.value)).toEqual([10, 20, null, 40]);
    expect(points[2]).toMatchObject({ min: null, max: null });
    expect(historyPoints(history(), 'tps')).toBeNull();
  });

  test('a metric is present only once a real value exists; zero counts, null does not', () => {
    expect(metricPresent(historyPoints(history(), 'players'))).toBe(false);
    expect(metricPresent([{ atMs: 0, value: 0, min: 0, max: 0 }])).toBe(true);
    expect(metricPresent(graphPoints({ history: history(), samples: [], metric: 'tps', range: '15m', nowMs: 30_000 }))).toBe(false);
    expect(metricPresent(graphPoints({ history: history(), samples: [sample(35_000, { tps: 19.8 })], metric: 'tps', range: '15m', nowMs: 40_000 }))).toBe(true);
  });

  test('live samples extend history after its last row and the window trims old points', () => {
    const points = graphPoints({ history: history(), samples: [sample(25_000), sample(32_000), sample(34_000, { cpuPercent: null })], metric: 'cpu', range: '15m', nowMs: 40_000 });
    expect(points.map((p) => [p.atMs, p.value])).toEqual([[0, 10], [10_000, 20], [20_000, null], [30_000, 40], [32_000, 50], [34_000, null]]);
    const later = graphPoints({ history: history(), samples: [], metric: 'cpu', range: '15m', nowMs: 15 * 60_000 + 15_000 });
    expect(later.map((p) => p.atMs)).toEqual([20_000, 30_000]);
  });

  test('at five-minute resolution live samples fold into aligned buckets after the last server bucket', () => {
    const bucket = RANGE_SPEC['24h'].bucketMillis;
    const live = livePoints([sample(bucket + 1_000, { cpuPercent: 10 }), sample(2 * bucket + 1_000, { cpuPercent: 10 }), sample(2 * bucket + 2_000, { cpuPercent: 30 })], 'cpu', bucket, bucket);
    expect(live).toEqual([{ atMs: 2 * bucket, value: 20, min: 10, max: 30 }]);
    const unknown = livePoints([sample(3 * bucket, { cpuPercent: null })], 'cpu', bucket, 0);
    expect(unknown).toEqual([{ atMs: 3 * bucket, value: null, min: null, max: null }]);
  });

  test('memory reads decimal byte strings; malformed is unknown', () => {
    expect(livePoints([sample(1), sample(2, { memoryUsedBytes: 'oops' })], 'memory', 10_000, 0).map((p) => p.value)).toEqual([1073741824, null]);
  });

  test('lines break at nulls and at missing time', () => {
    const p = (atMs, value) => ({ atMs, value, min: value, max: value });
    const runs = segments([p(0, 1), p(10_000, 2), p(20_000, null), p(30_000, 3), p(100_000, 4), p(110_000, 5)], maxStepMs(10_000));
    expect(runs.map((run) => run.map((point) => point.value))).toEqual([[1, 2], [3], [4, 5]]);
    expect(maxStepMs(300_000)).toBe(900_000);
  });

  test('domains: TPS out of 20, memory to the allocation, others headroom over the peak', () => {
    const p = (value) => ({ atMs: 0, value, min: value, max: value });
    expect(graphDomain('tps', [p(19.5)])).toEqual([0, 20]);
    expect(graphDomain('cpu', [p(40)])).toEqual([0, 100]);
    expect(graphDomain('cpu', [p(180)])).toEqual([0, 200]);
    expect(graphDomain('memory', [p(2e9)], 6e9)).toEqual([0, 6e9]);
    expect(graphDomain('memory', [p(2e9)], null)[1]).toBeGreaterThan(2e9);
    expect(graphDomain('players', [p(0)])).toEqual([0, 4]);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(0)).toBe(1);
  });

  test('hover, latest value and summary skip unknown points', () => {
    const p = (atMs, value) => ({ atMs, value, min: value, max: value });
    const points = [p(0, 4), p(10, null), p(20, 8)];
    expect(nearestIndex(points, 11)).toBe(2);
    expect(latestKnown([...points, p(30, null)])).toEqual(p(20, 8));
    expect(seriesStats(points)).toEqual({ min: 4, max: 8, avg: 6 });
    expect(seriesStats([p(0, null)])).toBeNull();
  });
});
