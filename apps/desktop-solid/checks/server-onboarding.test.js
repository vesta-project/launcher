import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VESTA_INSTALL_COMMAND, addRoute } from '../src/features/servers/onboarding-model.ts';

const root = join(import.meta.dir, '..');
const source = (path) => readFileSync(join(root, path), 'utf8');

test('/servers/add routes to setup, the install guide, connect, or re-pairing', () => {
  expect(addRoute(undefined)).toEqual({ kind: 'start' });
  expect(addRoute('connect')).toEqual({ kind: 'connect' });
  // Hosting here or elsewhere is one guide now.
  expect(addRoute('host')).toEqual({ kind: 'host' });
  expect(addRoute('remote')).toEqual({ kind: 'host' });
  // The old first server step after pairing a host now starts at Vesta Server setup.
  expect(addRoute('setup')).toEqual({ kind: 'start' });
  // Existing "pair again" links keep working.
  expect(addRoute('fixture-survival')).toEqual({ kind: 'reconnect', connectionId: 'fixture-survival' });
});

test('the guide is one install command on the server machine, then Connect a Vesta Server', () => {
  expect(VESTA_INSTALL_COMMAND).toStartWith('curl -fsSL https://raw.githubusercontent.com/vesta-project/server/');
  expect(VESTA_INSTALL_COMMAND).toContain('sudo bash /tmp/vesta-install.sh');
  const guide = source('src/pages/servers/onboarding.tsx');
  expect(guide).toContain('<CommandLine command={VESTA_INSTALL_COMMAND} />');
  expect(guide).toContain("transitionTo('/servers/setup')");
  // Nothing from the old per server pairing guide remains.
  const copy = source('src/localization/locales/en/servers.ftl');
  expect(copy).not.toMatch(/Vesta Host|vesta-setup setup-code|^servers-first-/m);
  expect(existsSync(join(root, 'src/pages/servers/first-server.tsx'))).toBe(false);
  expect(source('src/pages/servers/add-server.tsx')).not.toContain('guide');
});
