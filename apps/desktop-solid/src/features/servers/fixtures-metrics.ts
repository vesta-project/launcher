import type { ConnectionId, ServerSnapshot } from './native';
import type { HistoryMetric, MetricColumn, MetricsHistory, MetricsHistoryRequest } from './native-metrics';
interface Host<T extends { snapshot: ServerSnapshot }> { server(id: ConnectionId): T; requireOnline(target: T): void; requireCapability(target: T, capability: string): void }
export function createMetricsFixtures<T extends { snapshot: ServerSnapshot }>(host: Host<T>) {
  return { async metricsHistory(connectionId: ConnectionId, request: MetricsHistoryRequest): Promise<MetricsHistory> {
    const target = host.server(connectionId); host.requireOnline(target); host.requireCapability(target, 'metrics.view');
    const allowed: HistoryMetric[] = ['tps', 'game_cpu_percent', 'game_memory_bytes', 'players_online'];
    if (![request.from, request.to, request.maxPoints].every(Number.isSafeInteger) || !['raw', '5m', 'daily', 'auto'].includes(request.resolution) || (request.after != null && !/^\d+$/.test(request.after)) || request.series.length > 4 || !request.series.length || new Set(request.series).size !== request.series.length || request.series.some(s => !allowed.includes(s)) || request.from < 0 || request.to < request.from || request.to - request.from > 1825 * 86400000 || request.maxPoints < 1 || request.maxPoints > 2000 || (request.resolution === 'raw' && request.to - request.from > 7 * 86400000)) throw { code: 'invalid_input' };
    const resolution = request.resolution === 'auto' ? request.to - request.from <= 7200000 ? 'raw' : '5m' : request.resolution;
    const bucketMillis = resolution === 'raw' ? 10000 : resolution === '5m' ? 300000 : 86400000;
    const start = Math.ceil(request.from / bucketMillis) * bucketMillis;
    const count = request.after === String(request.to) ? 0 : Math.min(request.maxPoints, Math.max(0, Math.floor((request.to - start) / bucketMillis) + 1));
    const timestamps = Array.from({ length: count }, (_, i) => start + i * bucketMillis);
    const gaps = timestamps.map((_, i) => i % 31 === 12 || i % 31 === 13);
    const noTps = connectionId === 'fixture-creative';
    const series: MetricsHistory['series'] = {};
    for (const name of request.series) {
      const avg = timestamps.map((_, i) => gaps[i] || (name === 'tps' && noTps) ? null : name === 'tps' ? Math.min(20, 19.6 + Math.sin(i / 7) * .5) : name === 'game_cpu_percent' ? 22 + 12 * Math.sin(i / 5) : name === 'game_memory_bytes' ? 2400000000 + (i % 24) * 36000000 : Math.max(0, Math.round(4 + 3 * Math.sin(i / 8))));
      const samples = resolution === 'raw' ? 1 : resolution === '5m' ? 30 : 8640;
      const column: MetricColumn = { avg, min: avg.map(v => v === null ? null : resolution === 'raw' ? v : name === 'players_online' ? Math.floor(v * .96) : Math.max(0, v * .96)), max: avg.map(v => v === null ? null : resolution === 'raw' ? v : name === 'tps' ? Math.min(20, v * 1.02) : name === 'players_online' ? Math.ceil(v * 1.05) : v * 1.05), knownCount: avg.map(v => v === null ? 0 : samples), unknownCount: avg.map(v => v === null ? samples : 0) };
      series[name] = column;
    }
    return { timestamps, series, gaps, tickSource: timestamps.map((_, i) => noTps || gaps[i] ? null : 'spark'), resolution, bucketMillis, cursor: String(request.to), retentionGap: false };
  } };
}
