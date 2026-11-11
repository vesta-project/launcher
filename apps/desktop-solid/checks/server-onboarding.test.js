import { expect, test } from 'bun:test';
import { HOST_RELEASES_URL, LOCAL_HOST_ADDRESS, addRoute, hostGuideSteps, initialAddress } from '../src/features/servers/onboarding-model.ts';

test('/servers/add routes to the start page, the guides, connect, or re-pairing', () => {
  expect(addRoute(undefined)).toEqual({ kind: 'start' });
  expect(addRoute('connect')).toEqual({ kind: 'connect' });
  expect(addRoute('host')).toEqual({ kind: 'host', mode: 'local' });
  expect(addRoute('remote')).toEqual({ kind: 'host', mode: 'remote' });
  // Existing "pair again" links keep working.
  expect(addRoute('fixture-survival')).toEqual({ kind: 'reconnect', connectionId: 'fixture-survival' });
});

test('hosting on this PC starts connecting to the local host; elsewhere the person types the address', () => {
  expect(LOCAL_HOST_ADDRESS).toBe('localhost:8443');
  expect(initialAddress('local')).toBe(LOCAL_HOST_ADDRESS);
  expect(initialAddress('remote')).toBe('');
  expect(initialAddress(undefined)).toBe('');
});

test('the guide reads as one journey: install, then the usual connect steps', () => {
  expect(hostGuideSteps).toEqual(['servers.step.install', 'servers.step.address', 'servers.step.verify', 'servers.step.sign-in']);
});

test('installer commands come from the signed release page, never embedded pins', () => {
  const url = new URL(HOST_RELEASES_URL);
  expect(url.protocol).toBe('https:');
  expect(url.hostname).toBe('github.com');
  expect(url.pathname).toBe('/vesta-project/server/releases');
});
