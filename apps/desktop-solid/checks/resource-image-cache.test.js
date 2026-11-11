import { expect, test } from 'bun:test';
import { createImageCacheReader } from '../src/components/resource-image-cache';
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test('local reads batch visible URLs and deduplicate while a reply is in flight', async () => {
  const batches = [], replies = [];
  const read = createImageCacheReader(urls => { batches.push(urls); return new Promise(resolve => replies.push(resolve)); });
  const first = read('one'), duplicate = read('one'), second = read('two');
  expect(first).toBe(duplicate);
  await settle(); expect(batches).toEqual([['one', 'two']]);
  const during = read('one'), next = read('three');
  await settle(); expect(during).toBe(first); expect(batches).toHaveLength(1);
  replies.shift()({ one: 'data:cached' });
  expect(await first).toBe('data:cached'); expect(await second).toBeUndefined();
  await settle(); expect(batches).toEqual([['one', 'two'], ['three']]);
  replies.shift()({}); expect(await next).toBeUndefined();
});

test('local failures release every caller and later reads can retry', async () => {
  let calls = 0;
  const read = createImageCacheReader(async () => { if (++calls === 1) throw Error('busy'); return { one: 'data:cached' }; });
  expect(await read('one')).toBeUndefined();
  expect(await read('one')).toBe('data:cached');
});

test('cache batches remain bounded for large dependency lists', async () => {
  const sizes = [];
  const read = createImageCacheReader(async urls => { sizes.push(urls.length); return {}; });
  await Promise.all(Array.from({ length: 70 }, (_, i) => read(String(i))));
  expect(sizes).toEqual([32, 32, 6]);
});
