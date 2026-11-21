import { expect, test } from 'bun:test';
import { calculateRecommendedMemory, getGeneratedMemoryLimitMb, getRecommendedMaxMemoryForModCount } from '../src/features/installation/memory-policy';

const GB = 1024;

test('heap follows the mod count: light packs 4-6 GB, most modded 8, large packs 10-12', () => {
  expect(getRecommendedMaxMemoryForModCount(0)).toBe(4 * GB);
  expect(getRecommendedMaxMemoryForModCount(100)).toBe(7 * GB);
  expect(getRecommendedMaxMemoryForModCount(187)).toBe(8.5 * GB);
  expect(getRecommendedMaxMemoryForModCount(497)).toBe(12 * GB);
});

test('suggestions leave room for the system: 5 GB on 8 GB machines, 11 GB on 16 GB', () => {
  expect(getGeneratedMemoryLimitMb(8 * GB)).toBe(5 * GB);
  expect(getGeneratedMemoryLimitMb(16 * GB)).toBe(11 * GB);
  expect(getGeneratedMemoryLimitMb(64 * GB)).toBe(16 * GB);
  const big = calculateRecommendedMemory(16 * GB, 497, null, { defaultMinMemory: 2 * GB, defaultMaxMemory: 4 * GB });
  expect(big.max).toBe(11 * GB);
  expect(big.adjustment).toBe('high-for-device');
});

test('only a number the pack declares counts as the modpack\'s recommendation', () => {
  const counted = calculateRecommendedMemory(32 * GB, 187, null, { defaultMinMemory: 2 * GB, defaultMaxMemory: 4 * GB });
  expect(counted).toMatchObject({ source: 'mod-count', max: 8.5 * GB });
  const declared = calculateRecommendedMemory(32 * GB, 187, 10000, { defaultMinMemory: 2 * GB, defaultMaxMemory: 4 * GB });
  expect(declared.source).toBe('modpack');
});
