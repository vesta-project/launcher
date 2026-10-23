// Run with Bun. Synthetic, in-process data only: no network, WebView or server.
import { cpus, platform, release } from 'node:os';
import { ConsoleBuffer, CONSOLE_LINE_LIMIT } from '../src/features/servers/console-model';
import { toLogEntries } from '../src/features/servers/console-view';
import { filterLog, levelCounts } from '../src/components/log-view/log-model';

const batchSize = 64;
const batches = 512;
const repeats = 5;
const gapCopy = { label: 'Lines skipped', detail: 'See latest.log' };
const makeLines = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({
  cursor: `fixture.console.${start + index}`,
  text: `[12:00:00] [Server thread/INFO]: synthetic line ${start + index}`,
  truncated: false,
}));
const live = Array.from({ length: batches }, (_, i) => makeLines(CONSOLE_LINE_LIMIT + i * batchSize, batchSize));
const initial = makeLines(0, CONSOLE_LINE_LIMIT);
const recovery = makeLines(0, 2_000);
const round = (n: number) => Math.round(n * 1_000) / 1_000;
const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.ceil(sorted.length * fraction) - 1]);
};

function scenario(kind: 'append' | 'projection' | 'recovery') {
  const buffer = new ConsoleBuffer();
  buffer.append(initial);
  const parsed = new WeakMap();
  const elapsed: number[] = [];
  let consumed = 0;
  for (const batch of live) {
    const start = performance.now();
    if (kind === 'recovery') buffer.merge(recovery);
    else buffer.append(batch);
    if (kind === 'projection') {
      const entries = toLogEntries(buffer.entries, gapCopy, parsed);
      consumed += filterLog(entries, -Infinity, ['INFO', 'WARN', 'ERROR', 'DEBUG'], 'synthetic').length;
      consumed += levelCounts(entries).INFO;
    }
    elapsed.push(performance.now() - start);
  }
  return { elapsed, consumed, retained: buffer.entries.length, last: buffer.entries.at(-1)?.cursor };
}

const results = [];
for (const kind of ['append', 'projection', 'recovery'] as const) {
  // Warm JIT/parsers separately; do not count fixture generation or collection.
  scenario(kind);
  const elapsed: number[] = [];
  let consumed = 0;
  let retained = 0;
  let last: string | undefined;
  for (let i = 0; i < repeats; i++) {
    const sample = scenario(kind);
    elapsed.push(...sample.elapsed);
    consumed += sample.consumed;
    retained = sample.retained;
    last = sample.last;
  }
  const totalMs = elapsed.reduce((a, b) => a + b, 0);
  results.push({
    kind, samples: elapsed.length, totalMs: round(totalMs),
    p50Ms: percentile(elapsed, .5), p95Ms: percentile(elapsed, .95), maxMs: round(Math.max(...elapsed)),
    ...(kind === 'append' ? { linesPerSecond: Math.round(elapsed.length * batchSize * 1_000 / totalMs) } : {}),
    retained, last, consumed,
  });
}
console.log(JSON.stringify({
  timestamp: new Date().toISOString(), runtime: process.version, bun: process.versions.bun,
  platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
  batchSize, batches, repeats, lineLimit: CONSOLE_LINE_LIMIT,
  scope: 'Synchronous buffer/projection cost; excludes WebView, IPC, TLS, disk and rendering. No memory limit imposed.',
  memoryAtEnd: process.memoryUsage(), results,
}, null, 2));
