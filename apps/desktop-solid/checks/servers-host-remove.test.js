import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attemptKeys, canRemoveFromMachine, nameMatches, removeProblem } from '../src/features/servers/host-remove';
import { createHostFixtures } from '../src/features/servers/host-fixtures';

const root = join(import.meta.dir, '..');
const source = (path) => readFileSync(join(root, path), 'utf8');

describe('[remove] a server from its Vesta Server', () => {
  test('only machine owners, and the name must match exactly', () => {
    expect(canRemoveFromMachine('primary_owner')).toBe(true);
    expect(canRemoveFromMachine('owner')).toBe(true);
    expect(canRemoveFromMachine('admin')).toBe(false);
    expect(canRemoveFromMachine(null)).toBe(false);
    expect(nameMatches('Lobby', 'Lobby')).toBe(true);
    expect(nameMatches('lobby', 'Lobby')).toBe(false);
    expect(nameMatches('Lobby ', 'Lobby')).toBe(false);
    expect(nameMatches('', '')).toBe(false);
  });

  test('each refusal has its own short line, and not found means it is already gone', () => {
    expect(removeProblem({ code: 'invalid_input', reason: 'confirm_name_mismatch' })).toBe('name');
    expect(removeProblem({ code: 'server_busy', reason: 'server_busy' })).toBe('busy');
    expect(removeProblem({ code: 'conflict', reason: 'server_busy' })).toBe('busy');
    expect(removeProblem({ code: 'forbidden', reason: 'forbidden' })).toBe('forbidden');
    expect(removeProblem({ code: 'not_found' })).toBe('gone');
    expect(removeProblem({ code: 'unsupported' })).toBe('older');
    expect(removeProblem({ code: 'unreachable' })).toBe('other');
    const copy = source('src/localization/locales/en/servers.ftl').split('\n').filter((line) => line.startsWith('servers-host-remove-'));
    expect(copy.length).toBeGreaterThan(10);
    for (const line of copy) expect(line.slice(line.indexOf('=') + 1), line).not.toMatch(/\bagent\b| - | – | — |;|→|->/i);
  });

  test('one key per attempt: a retry reuses it, a changed name starts a new attempt', () => {
    let n = 0;
    const keys = attemptKeys(() => `k${++n}`);
    expect(keys.for('Lobby')).toBe('k1');
    expect(keys.for('Lobby')).toBe('k1');
    expect(keys.for('Lobby2')).toBe('k2');
    keys.reset();
    expect(keys.for('Lobby2')).toBe('k3');
  });

  test('the preview machine refuses a wrong name, can be busy or older, and repeats a receipt', async () => {
    const api = createHostFixtures({ hosts: 'servers' });
    const [host] = await api.list();
    await expect(api.removeServer(host.id, 'srv-lobby', 'lobby', 'a')).rejects.toMatchObject({ reason: 'confirm_name_mismatch' });
    const receipt = await api.removeServer(host.id, 'srv-lobby', 'Lobby', 'b');
    expect(receipt.serverId).toBe('srv-lobby');
    expect(Date.parse(receipt.restoreUntil) - Date.parse(receipt.removedAt)).toBe(7 * 86_400_000);
    expect(await api.removeServer(host.id, 'srv-lobby', 'Lobby', 'b')).toEqual(receipt);

    const busy = createHostFixtures({ hosts: 'servers', remove: 'busy' });
    const [busyHost] = await busy.list();
    await expect(busy.removeServer(busyHost.id, 'srv-lobby', 'Lobby', 'c')).rejects.toMatchObject({ reason: 'server_busy' });
    // Removal is offered only where the machine lists it; an older machine doesn't.
    expect((await api.info(host.id)).capabilities).toContain('server-remove');
    const old = createHostFixtures({ hosts: 'servers', remove: 'old' });
    const [oldHost] = await old.list();
    expect((await old.info(oldHost.id)).capabilities).not.toContain('server-remove');
  });

  test('the menu and Settings > General offer it, and native builds the body itself', () => {
    expect(source('src/pages/servers/server-header.tsx')).toContain('<HostRemoveDialog');
    expect(source('src/pages/servers/tabs/server-profile.tsx')).toContain('<HostRemoveRow');
    expect(source('src/features/servers/native-hosts.ts')).toContain("'server_remove'");
    const rust = source('../../vesta-launcher/src-tauri/src/commands/hosts.rs');
    expect(rust).toContain('ServerRemove => ("DELETE", format!("/servers/{}", id()?))');
    expect(rust).toContain('remove_body(body.as_ref(), &idempotency_key)');
  });
});
