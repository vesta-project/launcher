import { expect, test } from 'bun:test';
import { serverInstanceFallback } from '../src/features/servers/create-instance-model.ts';
import { errorMessage } from '../src/features/servers/errors.ts';
const snapshot = { connection: { name: 'My server' }, info: { minecraftVersion: '1.21.4' } };
test('creating from a server with no offered client pack uses its Minecraft version', () => {
  expect(serverInstanceFallback({ code: 'not_found', reason: 'pack_not_published' }, snapshot)).toEqual({ name: 'My server', minecraft: '1.21.4', loader: 'vanilla' });
  expect(errorMessage({ code: 'not_found', reason: 'pack_not_published' })).toBe('servers.cause.pack-not-published');
});
test('trust, connectivity and missing-server errors never turn into an unrelated instance', () => {
  for (const error of [{ code: 'not_found' }, { code: 'unreachable' }, { code: 'trust_changed' }]) expect(serverInstanceFallback(error, snapshot)).toBeNull();
  expect(serverInstanceFallback({ code: 'not_found', reason: 'pack_not_published' }, undefined)).toBeNull();
});

test('invalid pack contents show the pack failure instead of a stale edit conflict', () => {
 expect(errorMessage({code:'conflict',reason:'pack_invalid_index'})).toBe('server-pack.archive-invalid');
 expect(errorMessage({code:'conflict',reason:'pack_integrity_failure'})).toBe('server-pack.hash-mismatch');
});
