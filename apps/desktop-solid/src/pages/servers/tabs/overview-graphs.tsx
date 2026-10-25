// Overview performance graphs (D9): one card per metric the server reports (TPS, CPU,
// memory, players), seeded from server history and extended by the live metrics stream.
import { SegmentedControl, Skeleton } from '@vesta/ui';
import { For, Show, createMemo, createSignal, createUniqueId } from 'solid-js';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import {
  GRAPH_METRICS, GRAPH_RANGES, RANGE_SPEC, formatMetric, graphDomain, graphPoints, latestKnown, maxStepMs, metricPresent, nearestIndex, segments, seriesStats,
  type GraphMetric, type GraphPoint, type GraphRange,
} from '../../../features/servers/metrics-model';
import { useServerResource } from '../../../features/servers/resources';
import { metricsHistoryResource, propertiesResource } from '../../../features/servers/server-resources';
import { agentReachable } from '../../../features/servers/shell-model';
import { serverMetrics } from '../../../features/servers/store';
import type { ConnectionId, ServerSnapshot } from '../../../features/servers/native';
import { Freshness } from '../parts';

const metricLabels: Record<GraphMetric, MessageId> = {
  tps: 'servers.graphs.tps', cpu: 'servers.overview.cpu', memory: 'servers.overview.memory', players: 'servers.graphs.players',
};
const rangeLabels: Record<GraphRange, MessageId> = {
  '15m': 'servers.graphs.range-15m', '1h': 'servers.graphs.range-1h', '24h': 'servers.graphs.range-24h',
};

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** Plot geometry in viewBox units; the SVG stretches, strokes don't. */
const W = 1000;
const H = 120;
const PAD_TOP = 6;

export function OverviewGraphs(props: { snapshot: ServerSnapshot; id: ConnectionId; now: number }) {
  const [range, setRange] = createSignal<GraphRange>('1h', { name: 'server-graphs:range' });
  const reachable = () => agentReachable(props.snapshot);
  const history = useServerResource(() => props.id, metricsHistoryResource, { args: range, enabled: reachable });
  // Max players comes from server.properties, when this role may read it.
  const properties = useServerResource(() => props.id, propertiesResource, {
    enabled: () => reachable() && gate(props.snapshot.capabilities, 'config.view') !== 'denied',
  });
  const samples = () => serverMetrics(props.id);
  const series = createMemo(() => {
    const input = { history: history.value(), samples: samples(), range: range(), nowMs: props.now };
    return Object.fromEntries(GRAPH_METRICS.map((metric) => [metric, graphPoints({ ...input, metric })])) as Record<GraphMetric, GraphPoint[]>;
  }, { name: 'server-graphs:series' });
  const shown = () => GRAPH_METRICS.filter((metric) => metricPresent(series()[metric]));
  const bucketMillis = () => history.value()?.bucketMillis ?? RANGE_SPEC[range()].bucketMillis;
  const memoryLimit = () => {
    const raw = samples().at(-1)?.memoryMaxBytes;
    return raw && /^\d+$/.test(raw) ? Number(raw) : null;
  };
  const playerLimit = () => {
    const value = properties.value()?.values['max-players'];
    return typeof value === 'number' && value > 0 ? value : null;
  };
  const running = () => props.snapshot.status?.state === 'running';
  const waiting = () => history.loading() && !shown().length;

  return (
    <section data-vesta="server-graphs" aria-label={t('servers.overview.performance')}>
      <header data-vesta="server-graphs-head">
        <h2>{t('servers.overview.performance')}</h2>
        <Freshness atMs={samples().at(-1)?.atMs ?? null} now={props.now} phase={props.snapshot.state.phase} />
        <SegmentedControl
          size="sm"
          aria-label={t('servers.graphs.range')}
          value={range()}
          onChange={(value) => setRange(value as GraphRange)}
          options={GRAPH_RANGES.map((entry) => ({ value: entry, label: t(rangeLabels[entry]) }))}
        />
      </header>
      <Show
        when={!waiting()}
        fallback={<div data-vesta="server-graphs-grid"><Skeleton height={196} /><Skeleton height={196} /></div>}
      >
        <Show when={shown().length > 0} fallback={<p data-vesta="server-muted">{t('servers.graphs.empty')}</p>}>
          <div data-vesta="server-graphs-grid">
            <For each={shown()}>
              {(metric) => (
                <MetricGraph
                  metric={metric}
                  points={series()[metric]}
                  range={range()}
                  nowMs={props.now}
                  bucketMillis={bucketMillis()}
                  limit={metric === 'memory' ? memoryLimit() : metric === 'players' ? playerLimit() : null}
                  running={running()}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}

function MetricGraph(props: {
  metric: GraphMetric; points: GraphPoint[]; range: GraphRange; nowMs: number; bucketMillis: number; limit: number | null; running: boolean;
}) {
  const gradient = `server-graph-fill-${createUniqueId()}`;
  /** Hovered sample by time, so it stays put while the window slides. */
  const [hover, setHover] = createSignal<number | null>(null, { name: 'server-graph:hover' });
  const span = () => RANGE_SPEC[props.range].spanMs;
  const from = () => props.nowMs - span();
  const domain = () => graphDomain(props.metric, props.points, props.limit);
  const x = (atMs: number) => ((atMs - from()) / span()) * W;
  const y = (value: number) => {
    const [low, high] = domain();
    return PAD_TOP + (1 - (value - low) / (high - low || 1)) * (H - PAD_TOP);
  };
  const runs = createMemo(() => segments(props.points, maxStepMs(props.bucketMillis)), { name: 'server-graph:runs' });
  const line = (run: GraphPoint[]) => run.map((point, index) => `${index ? 'L' : 'M'}${x(point.atMs).toFixed(1)},${y(point.value!).toFixed(1)}`).join('');
  /** A lone sample still shows, as a short tick, rather than vanishing. */
  const stroke = (run: GraphPoint[]) => (run.length === 1 ? `M${(x(run[0].atMs) - 3).toFixed(1)},${y(run[0].value!).toFixed(1)}h6` : line(run));
  const area = (run: GraphPoint[]) => run.length < 2 ? '' : `${line(run)}L${x(run.at(-1)!.atMs).toFixed(1)},${H}L${x(run[0].atMs).toFixed(1)},${H}Z`;
  const latest = () => latestKnown(props.points);
  const stats = () => seriesStats(props.points);
  const fmt = (value: number) => formatMetric(props.metric, value);
  const active = () => { const at = hover(); return at === null ? null : props.points.find((point) => point.atMs === at && point.value !== null) ?? null; };
  const topLabel = () => fmt(domain()[1]);
  const summary = () => {
    const name = t(metricLabels[props.metric]);
    const current = latest();
    const known = stats();
    return current && known
      ? t('servers.graphs.summary', { name, time: t(rangeLabels[props.range]), value: fmt(current.value!), min: fmt(known.min), max: fmt(known.max) })
      : t('servers.graphs.summary-empty', { name });
  };

  const pick = (event: PointerEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const index = nearestIndex(props.points, from() + fraction * span());
    setHover(index < 0 ? null : props.points[index].atMs);
  };
  const step = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Escape') return;
    event.preventDefault();
    if (event.key === 'Escape') { setHover(null); return; }
    const known = props.points.filter((point) => point.value !== null).map((point) => point.atMs);
    if (!known.length) return;
    const current = hover();
    if (current === null || !known.includes(current)) { setHover(known.at(-1)!); return; }
    const at = known.indexOf(current);
    const next = event.key === 'ArrowLeft' ? Math.max(0, at - 1) : Math.min(known.length - 1, at + 1);
    setHover(known[next]);
  };

  return (
    <figure data-vesta="server-graph" data-metric={props.metric}>
      <figcaption data-vesta="server-graph-head">
        <span data-vesta="server-graph-label">{t(metricLabels[props.metric])}</span>
        <span data-vesta="server-graph-value" data-stale={props.running ? undefined : ''}>
          <strong>{latest() ? fmt(latest()!.value!) : ''}</strong>
          <Show when={props.limit}>
            {(limit) => <span>{t('servers.graphs.of-max', { max: fmt(limit()) })}</span>}
          </Show>
        </span>
        <span data-vesta="server-graph-summary">{summary()}</span>
      </figcaption>
      <div
        data-vesta="server-graph-plot"
        tabindex={0}
        aria-label={summary()}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={step}
      >
        <span data-vesta="server-graph-tick" aria-hidden="true">
          {props.metric === 'memory' && props.limit ? `${t('servers.graphs.allocated')} ${topLabel()}` : topLabel()}
        </span>
        <div data-vesta="server-graph-canvas">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="currentColor" stop-opacity="0.2" />
                <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <line data-vesta="server-graph-grid" x1="0" x2={W} y1={PAD_TOP} y2={PAD_TOP} data-limit={props.metric === 'memory' && props.limit ? '' : undefined} />
            <line data-vesta="server-graph-grid" x1="0" x2={W} y1={y(domain()[1] / 2)} y2={y(domain()[1] / 2)} />
            <line data-vesta="server-graph-grid" data-base="" x1="0" x2={W} y1={H} y2={H} />
            <For each={runs()} keyed={false}>
              {(run) => (
                <>
                  <path data-vesta="server-graph-area" d={area(run())} fill={`url(#${gradient})`} />
                  <path data-vesta="server-graph-line" d={stroke(run())} />
                </>
              )}
            </For>
          </svg>
          <Show when={active()}>
            {(point) => {
              const left = () => `${(x(point().atMs) / W) * 100}%`;
              const top = () => `${(y(point().value!) / H) * 100}%`;
              const flip = () => x(point().atMs) > W * 0.62;
              return (
                <>
                  <span data-vesta="server-graph-crosshair" style={{ left: left() }} aria-hidden="true" />
                  <span data-vesta="server-graph-dot" style={{ left: left(), top: top() }} aria-hidden="true" />
                  <span data-vesta="server-graph-tooltip" data-flip={flip() ? '' : undefined} style={{ left: left() }} role="status">
                    <strong>{fmt(point().value!)}</strong>
                    <Show when={point().min !== null && point().max !== null && point().min !== point().max}>
                      <span>{fmt(point().min!)}–{fmt(point().max!)}</span>
                    </Show>
                    <span>{clock.format(point().atMs)}</span>
                  </span>
                </>
              );
            }}
        </Show>
        </div>
      </div>
      <div data-vesta="server-graph-axis" aria-hidden="true">
        <span>{clock.format(from())}</span>
        <span>{clock.format(props.nowMs)}</span>
      </div>
    </figure>
  );
}
