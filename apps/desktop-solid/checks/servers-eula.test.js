import { expect, test } from 'bun:test';
import { createFixtureServers } from '../src/features/servers/fixtures.ts';
test('EULA consent is explicit, persisted per server, and permission gated', async () => {
  const servers = createFixtureServers({ latencyMs: 0 });
  expect(await servers.eula('fixture-survival')).toEqual({ accepted: true });
  expect(await servers.eulaUpdate('fixture-survival', false, 'eula-off')).toEqual({ accepted: false });
  expect(await servers.eula('fixture-survival')).toEqual({ accepted: false });
  expect(await servers.eulaUpdate('fixture-survival', true, 'eula-on')).toEqual({ accepted: true });
});
