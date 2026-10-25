// Overview graphs (D9): server-side history seeds each graph, live samples extend it.
// Unknown is never zero: nulls and missing time break the line, and a metric the server
// never reported has no graph at all.
import type { MetricsSample } from './native';
import type { HistoryMetric, MetricsHistory, MetricsHistoryRequest } from './native-metrics';

export type GraphMetric = 'tps' | 'cpu' | 'memory' | 'players';
export const GRAPH_METRICS: readonly GraphMetric[] = ['tps', 'cpu', 'memory', 'players'];

export const HISTORY_SERIES: Record<GraphMetric, HistoryMetric> = {
  tps: 'tps', cpu: 'game_cpu_percent', memory: 'game_memory_bytes', players: 'players_online',
};

export type GraphRange = '15m' | '1h' | '24h';
export const GRAPH_RANGES: readonly GraphRange[] = ['15m', '1h', '24h'];

/** Short windows read raw samples; a day reads five-minute aggregates. */
export const RANGE_SPEC: Record<GraphRange, { spanMs: number; resolution: 'raw' | '5m'; bucketMillis: number }> = {
  '15m': { spanMs: 15 * 60_000, resolution: 'raw', bucketMillis: 10_000 },
  '1h': { spanMs: 60 * 60_000, resolution: 'raw', bucketMillis: 10_000 },
  '24h': { spanMs: 24 * 60 * 60_000, resolution: '5m', bucketMillis: 5 * 60_000 },
};

export function historyRequest(range: GraphRange, nowMs: number): MetricsHistoryRequest {
  const spec = RANGE_SPEC[range];
  const to = Math.floor(nowMs);
  return { series: GRAPH_METRICS.map((metric) => HISTORY_SERIES[metric]), from: to - spec.spanMs, to, resolution: spec.resolution, maxPoints: 2000 };
}

export interface GraphPoint {
  atMs: number;
  /** Average for an aggregate bucket; null when unknown. */
  value: number | null;
  min: number | null;
  max: number | null;
}

const decimal = (value: string | null | undefined) => (value && /^\d+$/.test(value) ? Number(value) : null);

/** One live sample's value for a graph. */
export function sampleValue(sample: MetricsSample, metric: GraphMetric): number | null {
  switch (metric) {
    case 'tps': return sample.tps;
    case 'cpu': return sample.cpuPercent;
    case 'memory': return decimal(sample.memoryUsedBytes);
    case 'players': return sample.playersOnline;
  }
}

/** History rows for one metric, or null when the server returned no such series. */
export function historyPoints(history: MetricsHistory, metric: GraphMetric): GraphPoint[] | null {
  const column = history.series[HISTORY_SERIES[metric]];
  if (!column) return null;
  return history.timestamps.map((atMs, index) => {
    const gap = history.gaps[index] ?? false;
    return {
      atMs,
      value: gap ? null : column.avg[index] ?? null,
      min: gap ? null : column.min[index] ?? null,
      max: gap ? null : column.max[index] ?? null,
    };
  });
}

/**
 * Live samples after `afterMs`. At a coarse resolution they fold into buckets aligned
 * like the server's, so a day graph doesn't suddenly turn jagged at its right edge.
 */
export function livePoints(samples: readonly MetricsSample[], metric: GraphMetric, bucketMillis: number, afterMs: number): GraphPoint[] {
  const fresh = samples.filter((sample) => sample.atMs > afterMs);
  if (bucketMillis <= RANGE_SPEC['15m'].bucketMillis) {
    return fresh.map((sample) => { const value = sampleValue(sample, metric); return { atMs: sample.atMs, value, min: value, max: value }; });
  }
  const buckets = new Map<number, number[]>();
  const order: number[] = [];
  for (const sample of fresh) {
    const start = Math.floor(sample.atMs / bucketMillis) * bucketMillis;
    if (start <= afterMs) continue;
    if (!buckets.has(start)) { buckets.set(start, []); order.push(start); }
    const value = sampleValue(sample, metric);
    if (value !== null) buckets.get(start)!.push(value);
  }
  return order.map((atMs) => {
    const values = buckets.get(atMs)!;
    if (!values.length) return { atMs, value: null, min: null, max: null };
    return { atMs, value: values.reduce((sum, value) => sum + value, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
  });
}

/** History for the window, extended by live samples newer than its last row. */
export function graphPoints(input: { history: MetricsHistory | null | undefined; samples: readonly MetricsSample[]; metric: GraphMetric; range: GraphRange; nowMs: number; playerObservation?: { atMs: number; count: number } | null }): GraphPoint[] {
  const spec = RANGE_SPEC[input.range];
  const bucketMillis = input.history?.bucketMillis ?? spec.bucketMillis;
  const seeded = input.history ? historyPoints(input.history, input.metric) ?? [] : [];
  const last = seeded.at(-1)?.atMs ?? -Infinity;
  const live = livePoints(input.samples, input.metric, bucketMillis, last);
  const from = input.nowMs - spec.spanMs;
  const points = [...seeded, ...live].filter((point) => point.atMs >= from);
  const observation = input.metric === 'players' ? input.playerObservation : null;
  if (observation && Number.isInteger(observation.count) && observation.count >= 0 && observation.atMs >= from
    && observation.atMs >= (latestKnown(points)?.atMs ?? -Infinity)) {
    const point = { atMs: observation.atMs, value: observation.count, min: observation.count, max: observation.count };
    const at = points.findIndex((entry) => entry.atMs >= observation.atMs);
    if (at < 0) points.push(point);
    else if (points[at].atMs === observation.atMs) points[at] = point;
    else points.splice(at, 0, point);
  }
  return points;
}

/** A graph is shown only once the server has reported the metric at least once. */
export const metricPresent = (points: readonly GraphPoint[]) => points.some((point) => point.value !== null);

/** Longest step drawn as a continuous line; anything longer is missing time. */
export const maxStepMs = (bucketMillis: number) => Math.max(bucketMillis * 3, 30_000);

/** Runs of known points; a null or a jump longer than `maxStep` starts a new run. */
export function segments(points: readonly GraphPoint[], maxStep: number): GraphPoint[][] {
  const runs: GraphPoint[][] = [];
  let run: GraphPoint[] = [];
  let previous: GraphPoint | null = null;
  for (const point of points) {
    if (point.value === null || (previous && point.atMs - previous.atMs > maxStep)) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (point.value !== null) run.push(point);
    previous = point.value === null ? null : point;
  }
  if (run.length) runs.push(run);
  return runs;
}

export const latestKnown = (points: readonly GraphPoint[]) => {
  for (let index = points.length - 1; index >= 0; index--) if (points[index].value !== null) return points[index];
  return null;
};

export interface SeriesStats { min: number; max: number; avg: number }

/** Low, high and mean over the known points, for the accessible summary. */
export function seriesStats(points: readonly GraphPoint[]): SeriesStats | null {
  const known = points.filter((point) => point.value !== null);
  if (!known.length) return null;
  return {
    min: Math.min(...known.map((point) => point.min ?? point.value!)),
    max: Math.max(...known.map((point) => point.max ?? point.value!)),
    avg: known.reduce((sum, point) => sum + point.value!, 0) / known.length,
  };
}

/** Round up to 1, 2 or 5 × 10ⁿ so the top gridline lands on a readable value. */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value)!;
  return step * power;
}

/** Y range: TPS is out of 20; memory up to the allocation; others leave headroom over the peak. */
export function graphDomain(metric: GraphMetric, points: readonly GraphPoint[], limit: number | null = null): [number, number] {
  const peak = Math.max(0, ...points.map((point) => point.max ?? point.value ?? 0));
  switch (metric) {
    case 'tps': return [0, 20];
    case 'cpu': return [0, Math.max(100, niceCeil(peak))];
    case 'memory': return [0, limit && limit >= peak ? limit : niceCeil(peak * 1.15)];
    case 'players': return [0, Math.max(4, niceCeil(peak * 1.25))];
  }
}

/** Memory in GB with one decimal, or MB below 1 GB. */
export function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return gib >= 1 ? `${gib.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatMetric(metric: GraphMetric, value: number): string {
  switch (metric) {
    case 'tps': return value.toFixed(1);
    case 'cpu': return `${Math.round(value)}%`;
    case 'memory': return formatBytes(value);
    case 'players': return String(Math.round(value));
  }
}

/** Index of the point nearest `atMs`, for the hover crosshair. */
export function nearestIndex(points: readonly GraphPoint[], atMs: number): number {
  let best = -1;
  let distance = Infinity;
  points.forEach((point, index) => {
    if (point.value === null) return;
    const next = Math.abs(point.atMs - atMs);
    if (next < distance) { best = index; distance = next; }
  });
  return best;
}
