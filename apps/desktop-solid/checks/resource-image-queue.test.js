import { expect, test } from 'bun:test';
import { createResourceImageQueue } from '../src/components/resource-image-queue';
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test('visible images overtake nearby work and only one download runs at a time', async () => {
  const started = [], pending = [];
  const queue = createResourceImageQueue(url => { started.push(url); return new Promise(resolve => pending.push(resolve)); }, 1);
  queue.request('nearby', 1, () => {});
  queue.request('visible', 0, () => {});
  await settle(); expect(started).toEqual(['visible']);
  queue.request('new-visible', 0, () => {});
  pending.shift()(); await settle(); expect(started).toEqual(['visible', 'new-visible']);
  pending.shift()(); await settle(); expect(started).toEqual(['visible', 'new-visible', 'nearby']);
  pending.shift()(); await settle();
});

test('duplicate URLs share a request and cached decodes are reused', async () => {
  let loads = 0, finish;
  const results = [];
  const queue = createResourceImageQueue(() => { loads++; return new Promise(resolve => { finish = resolve; }); });
  const removed = queue.request('same', 1, ok => results.push(['removed', ok]));
  queue.request('same', 0, ok => results.push(['visible', ok]));
  await settle(); removed.dispose(); finish(); await settle();
  queue.request('same', 0, ok => results.push(['cached', ok]));
  expect(loads).toBe(1);
  expect(results).toEqual([['visible', true], ['cached', true]]);
});

test('virtualized rows cancel queued work and a failed image cannot block later icons', async () => {
  const started = [], results = [];
  const queue = createResourceImageQueue(async url => { started.push(url); if (url === 'bad') throw Error('offline'); });
  const removed = queue.request('offscreen', 0, () => {}); removed.dispose();
  queue.request('bad', 0, ok => results.push(ok));
  queue.request('good', 1, ok => results.push(ok));
  await settle(); await settle();
  expect(started).toEqual(['bad', 'good']); expect(results).toEqual([false, true]);
});

test('the bounded pool fills visible slots and does not wait for one slow icon', async () => {
  const started = [], pending = new Map();
  const queue = createResourceImageQueue(url => {
    started.push(url); return new Promise(resolve => pending.set(url, resolve));
  });
  for (let i = 0; i < 6; i++) queue.request(`icon-${i}`, 0, () => {});
  await settle(); expect(started).toHaveLength(4);
  pending.get('icon-1')('data:image/png;base64,cached'); await settle();
  expect(started).toHaveLength(5);
  let result;
  queue.request('icon-1', 0, (_ok, source) => { result = source; });
  expect(result).toBe('data:image/png;base64,cached');
  for (const finish of pending.values()) finish(); await settle();
  pending.get('icon-5')?.(); await settle();
});

test('cached images bypass occupied downloads and speculative work reserves visible slots', async () => {
  const started = [], pending = [];
  const queue = createResourceImageQueue(url => { started.push(url); return new Promise(resolve => pending.push(resolve)); });
  queue.request('near-one', 1, () => {}); queue.request('near-two', 1, () => {});
  await settle(); expect(started).toEqual(['near-one']);
  queue.request('visible', 0, () => {}); await settle(); expect(started).toEqual(['near-one', 'visible']);
  queue.remember('cached', 'data:local');
  expect(queue.peek('cached')).toBe('data:local');
  let resolved; queue.request('cached', 0, (_ok, source) => { resolved = source; });
  expect(resolved).toBe('data:local');
  for (const resolve of pending) resolve(); await settle(); pending.at(-1)(); await settle();
});

test('broken URLs do not restart downloads on every visibility change', async () => {
  let calls = 0;
  const queue = createResourceImageQueue(async () => { calls++; throw Error('offline'); });
  queue.request('broken', 0, () => {}); await settle();
  let failed; queue.request('broken', 0, ok => { failed = !ok; }); await settle();
  expect(failed).toBe(true); expect(calls).toBe(1);
});
