import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CODE_ALPHABET, CODE_GROUPS, CODE_LENGTH, HOST_PORT, backspaceCode, canonicalCode, codeChar, codeComplete, codeGroups, codeProblem, enrollProblemForFind,
  formatCode, groupServers, hostIdOf, setupProblem, typeIntoCode, waitSeconds, signInProblem, formatFingerprint, hostNameProblem, tidyHostName,
  importRootCommand, keepKey, machineState, parseVestaAddress, readCandidates, reviewSummary, sortDiscovered,
  KNOWN_IMPORT_ERRORS, KNOWN_WARNINGS, below, folderName, folderUse, importProblem, isDriveRoot, joinPath, lastSegment, locate,
  normalisePath, readFolderCheck, readNotServer, splitPath, warningMessage,
} from '../src/features/servers/host-model';
import { folderVerdict } from '../src/features/servers/host-add-model';
import { createHostFixtures } from '../src/features/servers/host-fixtures';

const root = join(import.meta.dir, '..');
const source = (path) => readFileSync(join(root, path), 'utf8');
const snapshot = (id, signInMethod = 'host') => ({ connection: { id, signInMethod } });
const host = (id, name = id) => ({ id, name, fingerprint: 'f', endpoints: [`${name}:25500`], deviceId: 'd', keyReference: 'k', accountId: 'a', authRevision: '1' });
const until = async (check, timeout = 8000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out');
};

describe('[hosts] codes and addresses', () => {
  test('setup codes group as typed, fold look alike letters and accept a pasted install line', () => {
    expect(canonicalCode('k7q4 mx29 p3ab')).toBe('K7Q4MX29P3AB');
    expect(formatCode('k7q4mx29p3')).toBe('K7Q4-MX29-P3');
    expect(canonicalCode('Setup code: K7Q4-MX29-P3AB     (new code any time: vesta setup-code)')).toBe('K7Q4MX29P3AB');
    expect(canonicalCode('OIL0')).toBe('0110');
    expect(codeComplete('K7Q4-MX29-P3AB')).toBe(true);
    expect(codeComplete('K7Q4-MX29')).toBe(false);
    expect(canonicalCode('K7Q4MX29P3ABEXTRA')).toHaveLength(12);
  });

  test('the code format matches the client crate', () => {
    const crate = readFileSync(join(root, '../../crates/vesta-host-client/src/lib.rs'), 'utf8');
    expect(crate).toContain(`pub const ALPHABET: &[u8] = b"${CODE_ALPHABET}";`);
    expect(crate).toContain('code.len() != 12');
    expect(CODE_LENGTH).toBe(12);
    expect(CODE_GROUPS.reduce((sum, size) => sum + size, 0)).toBe(CODE_LENGTH);
    expect(codeGroups().map((cells) => cells.join(','))).toEqual(['0,1,2,3', '4,5,6,7', '8,9,10,11']);
  });

  test('paste fills every cell from any reasonable form', () => {
    for (const pasted of [
      'K7Q4-MX29-P3AB', 'k7q4mx29p3ab', 'k7q4 mx29 p3ab', ' K7Q4 - MX29 - P3AB \n', 'K7Q4\u2009MX29\tP3AB',
      'Setup code: K7Q4-MX29-P3AB', 'code K7Q4 MX29 P3AB', 'K7Q4 MX29 P3AB expires in 30 minutes',
      'Your setup code is K7Q4MX29P3AB.', 'K7Q4-MX29-P3AB (vesta setup-code)',
    ]) expect(canonicalCode(pasted), pasted).toBe('K7Q4MX29P3AB');
    // Not a code character at all: nothing to paste.
    expect(canonicalCode('!!!')).toBe('');
    // A partial paste fills from the start.
    expect(canonicalCode('k7q4-mx')).toBe('K7Q4MX');
  });

  test('typing accepts only code characters and fills cells in order', () => {
    expect(codeChar('a')).toBe('A');
    expect(codeChar('o')).toBe('0');
    expect(codeChar('l')).toBe('1');
    for (const bad of ['u', 'U', '-', ' ', '!', 'é', 'ab', '']) expect(codeChar(bad), bad).toBeNull();
    expect(typeIntoCode('', 0, 'k')).toEqual({ value: 'K', focus: 1 });
    // Clicking ahead never leaves a gap.
    expect(typeIntoCode('K7', 9, 'q')).toEqual({ value: 'K7Q', focus: 3 });
    // Typing over a filled cell replaces it.
    expect(typeIntoCode('K7Q4', 1, '8')).toEqual({ value: 'K8Q4', focus: 2 });
    expect(typeIntoCode('K7Q4MX29P3A', 11, 'b')).toEqual({ value: 'K7Q4MX29P3AB', focus: 11 });
    expect(typeIntoCode('K7', 2, 'u')).toBeNull();
  });

  test('backspace clears a filled cell, or steps back from an empty one', () => {
    expect(backspaceCode('K7Q4', 3)).toEqual({ value: 'K7Q', focus: 3 });
    expect(backspaceCode('K7Q', 3)).toEqual({ value: 'K7', focus: 2 });
    expect(backspaceCode('K7Q', 7)).toEqual({ value: 'K7', focus: 2 });
    expect(backspaceCode('', 0)).toEqual({ value: '', focus: 0 });
  });

  test('Vesta addresses default to port 25500 and keep an explicit port', () => {
    expect(parseVestaAddress('192.168.1.67')).toMatchObject({ kind: 'address', port: HOST_PORT, display: '192.168.1.67:25500' });
    expect(parseVestaAddress('vps.example.net:8443')).toMatchObject({ port: 8443 });
    expect(parseVestaAddress('[::1]')).toMatchObject({ display: '[::1]:25500' });
    expect(parseVestaAddress('ftp://x').kind).toBe('invalid');
  });
});

describe('[hosts] discovery and enrollment', () => {
  const found = [
    { hostId: 'b', name: 'attic', fingerprint: 'f', address: '10.0.0.2:25500', state: 'claimed' },
    { hostId: 'a', name: 'people-server', fingerprint: 'f', address: '10.0.0.1:25500', state: 'unclaimed' },
    { hostId: 'c', name: 'mine', fingerprint: 'f', address: '10.0.0.3:25500', state: 'claimed' },
    { hostId: 'a', name: 'people-server', fingerprint: 'f', address: '[fe80::1]:25500', state: 'unclaimed' },
  ];
  test('machines this device is linked to sign in; set up ones sign in as the account; ready ones list first', () => {
    const hosts = [{ id: 'c' }];
    expect(machineState(found[0], hosts)).toBe('claimed');
    expect(machineState(found[1], hosts)).toBe('ready');
    expect(machineState(found[2], hosts)).toBe('linked');
    expect(sortDiscovered(found, hosts).map((entry) => entry.hostId)).toEqual(['a', 'c', 'b']);
  });

  test('each setup failure maps to one honest cause', () => {
    const kind = (error, purpose = 'claim') => setupProblem(error, purpose).kind;
    expect(kind({ code: 'unreachable' })).toBe('unreachable');
    expect(kind({ code: 'tls_failed' })).toBe('unreachable');
    expect(kind({ code: 'timeout' })).toBe('unreachable');
    expect(kind({ code: 'credentials_rejected', reason: 'pairing_failed' })).toBe('wrong-code');
    expect(setupProblem({ code: 'credentials_rejected', reason: 'pairing_failed' }, 'link').message).toBe('vesta-server.problem.link-wrong');
    expect(kind({ code: 'credentials_rejected', reason: 'code_expired' })).toBe('expired-code');
    expect(setupProblem({ code: 'credentials_rejected', reason: 'code_expired' }, 'claim').message).toBe('vesta-server.problem.code-expired');
    expect(setupProblem({ code: 'rate_limited', retryAfterMs: 42_000 }, 'claim')).toMatchObject({ kind: 'too-many', retryAfterMs: 42_000 });
    expect(waitSeconds(42_000)).toBe(42);
    expect(waitSeconds(1)).toBe(1);
    expect(waitSeconds(undefined)).toBe(60);
    expect(kind({ code: 'conflict', reason: 'host_already_claimed' })).toBe('claimed');
    expect(kind({ code: 'conflict' })).toBe('claimed');
    expect(kind({ code: 'credentials_unavailable', reason: 'account_signin_required' })).toBe('account-signin');
    expect(kind({ code: 'credentials_rejected', reason: 'account_proof_failed' })).toBe('account-proof');
    // Mojang being down is not the machine being down.
    expect(kind({ code: 'unreachable', reason: 'account_service_unreachable' })).toBe('account-offline');
    expect(kind({ code: 'server_busy', reason: 'account_verification_unavailable' })).toBe('account-offline');
    expect(kind({ code: 'forbidden' })).toBe('no-access');
    expect(codeProblem('wrong-code')).toBe(true);
    expect(codeProblem('expired-code')).toBe(true);
    expect(codeProblem('unreachable')).toBe(false);
    expect(enrollProblemForFind({ code: 'unreachable' })).toBe('vesta-server.problem.unreachable');
  });

  test('account sign in maps each answer to where it leads', () => {
    const kind = (error) => signInProblem(error).kind;
    expect(kind({ code: 'forbidden', reason: 'account_has_no_access' })).toBe('no-access');
    expect(kind({ code: 'forbidden', reason: 'device_approval_required' })).toBe('approval');
    expect(signInProblem({ code: 'forbidden', reason: 'device_approval_required' }).message).toBe('vesta-server.account.approval');
    expect(kind({ code: 'unreachable' })).toBe('unreachable');
    expect(kind({ code: 'timeout' })).toBe('unreachable');
    // A different machine answering, or a challenge that doesn't add up, is never "offline".
    expect(kind({ code: 'fingerprint_mismatch' })).toBe('identity');
    expect(kind({ code: 'fingerprint_mismatch', reason: 'server_hash_mismatch' })).toBe('identity');
    expect(kind({ code: 'fingerprint_mismatch', reason: 'host_identity_changed' })).toBe('identity');
    // No code is involved, so a refused or expired proof is about the account, not a code.
    expect(kind({ code: 'credentials_rejected', reason: 'account_proof_failed' })).toBe('account-proof');
    expect(kind({ code: 'credentials_rejected', reason: 'pairing_failed' })).toBe('account-proof');
    expect(kind({ code: 'credentials_rejected' })).toBe('account-proof');
    expect(kind({ code: 'credentials_unavailable', reason: 'account_signin_required' })).toBe('account-signin');
    expect(kind({ code: 'server_busy', reason: 'account_verification_unavailable' })).toBe('account-offline');
    expect(signInProblem({ code: 'rate_limited', retryAfterMs: 12_000 })).toMatchObject({ kind: 'too-many', retryAfterMs: 12_000 });
    expect(kind({ code: 'conflict', reason: 'device_key_unusable' })).toBe('other');
    // Opening a machine this device already knows says the same when the account has no role.
    expect(enrollProblemForFind({ code: 'forbidden', reason: 'account_has_no_access' })).toBe('vesta-server.problem.no-access');
    expect(enrollProblemForFind({ code: 'fingerprint_mismatch', reason: 'host_identity_changed' })).toBe('vesta-server.problem.identity');
  });

  test('the serverHash is checked before the Mojang join, for every purpose', () => {
    const client = readFileSync(join(root, '../../crates/vesta-server-client/src/host.rs'), 'utf8');
    const prove = client.slice(client.indexOf('async fn prove_account'), client.indexOf('pub fn device_name'));
    expect(prove.indexOf('checked_server_hash(')).toBeGreaterThan(0);
    expect(prove.indexOf('checked_server_hash(')).toBeLessThan(prove.indexOf('join(server_hash'));
    // Both the code flows and account sign in go through it.
    expect(client.match(/prove_account\(\s*&mut self\.connection/g)).toHaveLength(2);
    expect(client).toContain('vesta_host_client::requests::account_server_hash(');
    // The helper is the server's own, byte for byte.
    const ours = readFileSync(join(root, '../../crates/vesta-host-client/src/requests.rs'), 'utf8');
    expect(ours).toContain('pub fn account_server_hash(');
  });

  test('the native layer names each cause instead of collapsing them', () => {
    const native = readFileSync(join(root, '../../vesta-launcher/src-tauri/src/servers/hosts.rs'), 'utf8');
    const client = readFileSync(join(root, '../../crates/vesta-server-client/src/host.rs'), 'utf8');
    for (const reason of ['account_signin_required', 'account_service_unreachable', 'account_proof_failed', 'code_expired', 'server_hash_mismatch', 'host_identity_changed', 'device_revoked'])
      expect(native + client, reason).toContain(`"${reason}"`);
    // A revoked device or a lost key signs in again with the account before anything is shown.
    expect(native).toContain('Some("device_revoked")');
    expect(native).toContain('self.host_recover(app, id, &device)');
    expect(client).toContain('"host_already_claimed"');
    expect(client).toContain('"pairing_failed"');
    // The code is never logged.
    expect(native).not.toMatch(/log::[a-z]+!\([^)]*code/);
  });
});

describe('[hosts] import review', () => {
  test('the permission command quotes paths for the machine it runs on', () => {
    expect(importRootCommand('/home/games/Modded')).toBe('sudo vesta import-root add /home/games/Modded');
    expect(importRootCommand('/srv/my server')).toBe('sudo vesta import-root add "/srv/my server"');
    expect(importRootCommand('D:\\mc\\survival')).toBe('vesta import-root add D:\\mc\\survival');
  });

  test('candidates list ready ones first, keep the permission command, and ignore machine wide warnings', () => {
    const read = readCandidates({
      candidates: [
        { candidateId: '1', label: 'zeta', displayPath: '/srv/zeta', folderToken: 't1', loader: 'paper', bytes: 2048 },
        { candidateId: '2', label: 'Locked', displayPath: '/home/games/Locked', folderToken: null, remediationCommand: "sudo vesta import-root add '/home/games/Locked'" },
        { candidateId: '3', displayPath: '/srv/alpha', folderToken: 't3' },
        { label: 'no path' },
        null,
      ],
      warnings: [{ code: 'source_unreadable', displayPath: '/home', remediation: { command: 'sudo vesta import-root add /home' } }, { nope: 1 }],
    });
    expect(read.candidates.map((entry) => entry.label)).toEqual(['alpha', 'zeta', 'Locked']);
    expect(read.candidates[1]).toMatchObject({ software: 'Paper', bytes: 2048, command: null });
    expect(read.candidates[2]).toMatchObject({ folderToken: null, command: "sudo vesta import-root add '/home/games/Locked'" });
    expect(read.truncated).toBe(false);
    expect(readCandidates({ candidates: [], warnings: [{ code: 'scan_truncated' }] }).truncated).toBe(true);
    expect(readCandidates(null)).toEqual({ candidates: [], truncated: false });
  });

  test('every documented route error and warning has its own friendly line', () => {
    const routeErrors =['eula_required', 'warnings_unacknowledged', 'source_stop_confirmation_required', 'import_job_not_found', 'conflict', 'idempotency_conflict',
      'plan_blocked', 'plan_expired', 'confirmation_invalid', 'server_capacity_reached', 'imports_unavailable', 'import_jobs_saturated', 'worker_unavailable', 'unavailable'];
    for (const code of ['disable_amp_auto_restart', 'rcon_disabled']) {
      expect(KNOWN_WARNINGS).toContain(code);
      expect(warningMessage(code), code).not.toBe('vesta-server.warning.other');
    }
    expect(KNOWN_IMPORT_ERRORS).toEqual(expect.arrayContaining(routeErrors));
    for (const code of routeErrors) {
      expect(importProblem(code), code).not.toBe('vesta-server.import.failed');
      expect(importProblem({ code: 'conflict', reason: code }), code).toBe(importProblem(code));
    }
    expect(importProblem('something_new')).toBe('vesta-server.import.failed');
  });

  test('copy names the product, never a hosting panel', () => {
    const copy = source('src/localization/locales/en/vesta-server.ftl');
    expect(copy).not.toMatch(/\bAMP\b|CubeCoders|Pterodactyl|Import folder \d/i);
    expect(source('src/pages/servers/host-import.tsx')).not.toMatch(/\bAMP\b|root\.label/);
  });

  test('the summary reads software, version, size and port', () => {
    const review = {
      source: { displayPath: '/x', files: 10, bytes: 2048 }, destination: { freeBytes: 9 }, resources: { gamePort: 25566, memoryMiB: 4096 },
      detected: { minecraftVersion: '1.21.1', loader: 'fabric', instanceName: 'Survival' }, runtime: { requiredMajor: 21 },
    };
    expect(reviewSummary(review)).toMatchObject({ software: 'Fabric', minecraftVersion: '1.21.1', bytes: 2048, gamePort: 25566, javaMajor: 21 });
    expect(reviewSummary({ ...review, detected: { minecraftVersion: '1.20.1' } }).software).toBe('Vanilla');
    expect(reviewSummary({ ...review, detected: null, runtime: null }).software).toBeNull();
    expect(keepKey({ code: 'outcome_unknown' })).toBe(true);
    expect(keepKey({ code: 'conflict' })).toBe(false);
  });
});

describe('[hosts] folders on the machine', () => {
  test('paths split, join and nest on Linux and Windows', () => {
    expect(splitPath('/srv/minecraft/lobby')).toEqual({ root: '/', parts: ['srv', 'minecraft', 'lobby'] });
    expect(splitPath('d:\\games\\mc')).toEqual({ root: 'D:\\', parts: ['games', 'mc'] });
    expect(joinPath('D:\\', ['games', 'mc'])).toBe('D:\\games\\mc');
    expect(normalisePath('  "/srv/my server/"  ')).toBe('/srv/my server');
    expect(normalisePath('relative/path')).toBeNull();
    expect(normalisePath('/srv/../etc')).toBeNull();
    expect(below('/home/eatham', '/home/eatham/servers/Survival')).toEqual(['servers', 'Survival']);
    expect(below('C:\\Games', 'c:\\games\\mc')).toEqual(['mc']);
    expect(below('/srv', '/home')).toBeNull();
    expect(isDriveRoot('/')).toBe(true);
    expect(folderName('/home/eatham/h12-import-test/Minecraft')).toBe('Minecraft');
    expect(lastSegment('/home/eatham/h12-import-test/Minecraft')).toBe('h12-import-test');
  });

  test('a path opens through the preferred root, else the nearest readable one', () => {
    const roots = [
      { rootId: 'top', displayPath: '/', readable: true },
      { rootId: 'saved', displayPath: '/home/eatham/h12-import-test/Minecraft', readable: true },
      { rootId: 'locked', displayPath: '/srv', readable: false },
    ];
    expect(locate('/home/eatham/h12-import-test/Minecraft/world', roots)).toMatchObject({ root: { rootId: 'saved' }, segments: ['world'] });
    expect(locate('/home/eatham/h12-import-test/Minecraft/world', roots, 'top')).toMatchObject({ root: { rootId: 'top' } });
    expect(locate('/srv/lobby', roots)).toMatchObject({ root: { rootId: 'top' }, segments: ['srv', 'lobby'] });
    expect(locate('/srv/lobby', roots.slice(1))).toBeNull();
  });

  test('Use this folder always has a reason when it can not be used', () => {
    expect(folderUse({ top: true, looksLikeServer: true })).toEqual({ usable: false, reason: 'vesta-server.import.why-top' });
    expect(folderUse({ looksLikeServer: true })).toEqual({ usable: true });
    expect(folderUse({ looksLikeServer: false })).toMatchObject({ usable: false, reason: 'vesta-server.import.why-no-server-file' });
    expect(folderUse({ missing: ['world', 'server_jar'] })).toMatchObject({ reason: 'vesta-server.import.why-no-jar' });
    expect(folderUse({})).toBeNull();
    expect(readNotServer({ blockers: ['not_minecraft_server'], inspection: { missing: ['world'] } })).toEqual({ notServer: true, missing: ['world'] });
    expect(readNotServer({ blockers: [{ code: 'not_minecraft_server', missing: ['server_jar'] }] })).toEqual({ notServer: true, missing: ['server_jar'] });
    expect(readNotServer({ blockers: ['not_minecraft_server'] })).toEqual({ notServer: true, missing: ['server_properties'] });
    expect(readNotServer({ blockers: [] })).toEqual({ notServer: false, missing: [] });
    expect(readNotServer(null).notServer).toBe(false);
    expect(folderVerdict({ blockers: ['not_minecraft_server'], missing: ['world'] }, '/x')).toMatchObject({ kind: 'not-server', reason: 'vesta-server.import.why-no-world' });
  });

  test('a typed path reads as found, needs permission, or one plain problem', () => {
    expect(readFolderCheck({ path: '/srv/a', status: 'ok', folderToken: 't' }, '/srv/a')).toEqual({ kind: 'ok', path: '/srv/a', token: 't' });
    expect(readFolderCheck({ path: '/srv/a', status: 'permission_needed', remediationCommand: 'run me' }, '/srv/a')).toMatchObject({ kind: 'permission', command: 'run me' });
    expect(readFolderCheck({ status: 'permission_needed' }, '/srv/a')).toMatchObject({ kind: 'permission', command: 'sudo vesta import-root add /srv/a' });
    expect(readFolderCheck({ status: 'not_directory' }, '/a.jar')).toMatchObject({ kind: 'problem', message: 'vesta-server.import.path-not-folder' });
    expect(readFolderCheck({ status: 'protected' }, '/var/lib/vesta')).toMatchObject({ message: 'vesta-server.import.path-protected' });
    expect(readFolderCheck({ status: 'ok', folderToken: null }, '/x')).toMatchObject({ kind: 'problem', message: 'vesta-server.import.path-not-found' });
    expect(readFolderCheck(undefined, '/x')).toMatchObject({ kind: 'problem' });
  });

  test('the preview machine answers every path check the screen handles', async () => {
    const api = createHostFixtures({ hosts: 'one' });
    const [machine] = await api.list();
    const status = async (path) => (await api.folderCheck(machine.id, path)).status;
    expect(await status('/home/eatham/servers/Survival')).toBe('ok');
    expect(await status('/srv/minecraft/lobby')).toBe('permission_needed');
    expect(await status('/home/eatham/Downloads/fabric-installer.jar')).toBe('not_directory');
    expect(await status('/var/lib/vesta')).toBe('protected');
    expect(await status('/nope')).toBe('not_found');
    const { roots } = await api.folderRoots(machine.id);
    expect(roots.map((root) => root.displayPath)).toContain('/');
    expect(readCandidates(await createHostFixtures({ hosts: 'one', found: 'none' }).importCandidates(machine.id)).candidates).toEqual([]);
  });
});

describe('[hosts] servers list', () => {
  test('servers group under their machine only when there is more than one machine', () => {
    const list = [snapshot('h1:s1'), snapshot('h2:s2'), snapshot('legacy', 'pairing_code'), snapshot('h1:s3')];
    expect(hostIdOf(list[0])).toBe('h1');
    expect(hostIdOf(list[2])).toBeNull();
    expect(groupServers(list, []).map((group) => group.servers.length)).toEqual([4]);
    expect(groupServers(list, [host('h1')])).toEqual([{ key: 'all', host: null, servers: list }]);
    const grouped = groupServers(list, [host('h1', 'people-server'), host('h2', 'attic')]);
    expect(grouped.map((group) => [group.key, group.servers.map((entry) => entry.connection.id)])).toEqual([
      ['host:h1', ['h1:s1', 'h1:s3']], ['host:h2', ['h2:s2']], ['other', ['legacy']],
    ]);
  });

  test('setup replaces Add server as the start, legacy pairing keeps only its own routes', () => {
    const page = source('src/pages/servers/servers-page.tsx');
    // `/servers/setup` and a bare `/servers/add` start with Vesta Server setup.
    expect(page).toContain("<Match when={target().kind === 'start'}><VestaSetup /></Match>");
    expect(page).not.toContain('serverStartChoices');
    // Re-pairing a saved connection and the connect guide stay on `/servers/add/<detail>`.
    expect(page).toContain("<Match when={target().kind === 'connect'}><AddServer /></Match>");
    expect(source('src/app/rail.tsx')).toContain("transitionTo('/servers/setup')");
    // Legacy saved connections still render as normal cards from the same list.
    expect(page).toContain('serverSnapshots()');
  });

  test('UI copy never says agent, pending or activate, and has no dashes, semicolons or arrows', () => {
    const lines = source('src/localization/locales/en/vesta-server.ftl').split('\n').filter((line) => /^vesta-server-[a-z0-9-]+ = /.test(line));
    for (const line of lines) {
      // Fluent selectors (`{ $count ->`) are syntax, not copy.
      const value = line.slice(line.indexOf('=') + 1).replace(/\{\s*\$\w+\s*->/g, '');
      expect(value, line).not.toMatch(/\bagent\b|\bpending\b|\bactivate\b|host root/i);
      expect(value, line).not.toMatch(/ - | – | — |;|→|->/);
    }
    expect(lines.length).toBeGreaterThan(100);
  });
});

describe('[hosts] machine settings', () => {
  test('a machine name is tidied and must fit in 63 bytes', () => {
    expect(tidyHostName('  attic\u200b  pc \n')).toBe('attic pc');
    expect(hostNameProblem('   ')).toBe('empty');
    expect(hostNameProblem('a'.repeat(63))).toBeNull();
    expect(hostNameProblem('a'.repeat(64))).toBe('long');
    // Bytes, not characters: 21 three byte characters fill it exactly.
    expect(hostNameProblem('\u20ac'.repeat(21))).toBeNull();
    expect(hostNameProblem('\u20ac'.repeat(22))).toBe('long');
  });

  test('a fingerprint reads in groups of four', () => {
    expect(formatFingerprint('ABCD1234ef')).toBe('abcd 1234 ef');
    expect(formatFingerprint('')).toBe('');
  });
});

describe('[hosts] account sign in', () => {
  const attic = async (api) => (await api.discover()).find((entry) => entry.state === 'claimed');

  test('a set up machine signs in as the account, with no code, and lists its servers', async () => {
    const api = createHostFixtures();
    const found = await attic(api);
    const host = await api.signInWithAccount(found.address, found.hostId, 'uuid', 'ATTIC-LAPTOP');
    expect(host.id).toBe(found.hostId);
    expect((await api.list()).map((entry) => entry.id)).toEqual([found.hostId]);
    expect((await api.servers(found.hostId)).servers.length).toBeGreaterThan(0);
    expect((await api.devices(found.hostId)).devices.map((device) => device.name)).toContain('ATTIC-LAPTOP');
    // Another machine at the picked address is an identity change, never a new pin.
    await expect(api.signInWithAccount(found.address, 'someone-else', 'uuid', 'x')).rejects.toMatchObject({ reason: 'host_identity_changed' });
  }, 10_000);

  test('no role and approval mode come back as answers, and nothing is added', async () => {
    for (const [signin, kind] of [['no-access', 'no-access'], ['approval', 'approval']]) {
      const api = createHostFixtures({ signin });
      const found = await attic(api);
      const error = await api.signInWithAccount(found.address, found.hostId, 'uuid', 'x').catch((reason) => reason);
      expect(signInProblem(error).kind, signin).toBe(kind);
      expect(await api.list()).toEqual([]);
    }
  }, 10_000);

  test('owners rename the machine and switch new devices to approval', async () => {
    const api = createHostFixtures({ hosts: 'one' });
    const [machine] = await api.list();
    expect((await api.info(machine.id)).newDeviceSignIn).toBe('account');
    expect((await api.update(machine.id, { name: '  Attic   PC ' })).name).toBe('Attic PC');
    await expect(api.update(machine.id, { name: 'a'.repeat(64) })).rejects.toMatchObject({ reason: 'invalid_request' });
    await api.update(machine.id, { newDeviceSignIn: 'approval' });
    expect((await api.info(machine.id)).newDeviceSignIn).toBe('approval');
    const { owners } = await api.owners(machine.id);
    expect(owners[0]).toMatchObject({ role: 'primary_owner' });
  });

  test('the setup screen asks for no code on a set up machine and trusts it in one calm line', () => {
    const page = source('src/pages/servers/vesta-setup.tsx');
    expect(page).toContain("if (state === 'claimed') return toSignIn(next);");
    expect(page).toContain("'vesta-server.account.trust'");
    expect(page).toContain('<details>');
    expect(page).toContain("toLinkCode(current, 'vesta-server.account.approval')");
    expect(page).toContain('<AccountMenu');
    // The device name is the computer's own; the platform label is only a fallback.
    const native = readFileSync(join(root, '../../vesta-launcher/src-tauri/src/commands/hosts.rs'), 'utf8');
    expect(native.match(/ServerManager::host_device_name\(&device_name\)/g)).toHaveLength(3);
  });

  test('the settings page binds the approval switch to the machine setting', () => {
    const page = source('src/pages/servers/host-settings.tsx');
    expect(page).toContain("newDeviceSignIn: on ? 'approval' : 'account'");
    expect(page).toContain('client.owners(id())');
    expect(page).toContain("client.update(id(), { name })");
    const commands = readFileSync(join(root, '../../vesta-launcher/src-tauri/src/commands/hosts.rs'), 'utf8');
    expect(commands).toContain('Update => ("PATCH", "".into())');
    expect(commands).toContain('Owners => ("GET", "/owners".into())');
  });
});

describe('[hosts] fixture flow', () => {
  test('claim, check a running server, check again, copy and cancel', async () => {
    const api = createHostFixtures();
    const lan = await api.discover();
    const ready = lan.find((entry) => entry.state === 'unclaimed');
    // A complete code is checked on its own, before any account step.
    await expect(api.verifyCode(ready.address, 'AAAA-AAAA-AAAA', 'claim')).rejects.toMatchObject({ reason: 'pairing_failed' });
    await expect(api.verifyCode('10.0.0.9', 'K7Q4MX29P3AB', 'claim')).rejects.toMatchObject({ code: 'unreachable' });
    await expect(api.verifyCode(lan.find((entry) => entry.state === 'claimed').address, 'K7Q4MX29P3AB', 'claim')).rejects.toMatchObject({ reason: 'host_already_claimed' });
    expect(await api.verifyCode(ready.address, 'k7q4 mx29 p3ab', 'claim')).toMatchObject({ hostId: ready.hostId });
    await expect(api.claim(ready.address, 'AAAA-AAAA-AAAA', 'uuid', 'Windows PC')).rejects.toMatchObject({ reason: 'pairing_failed' });
    const claimed = await api.claim(ready.address, 'k7q4-mx29-p3ab', 'uuid', 'Windows PC');
    expect((await api.list()).map((entry) => entry.id)).toEqual([claimed.id]);
    await expect(api.claim(ready.address, 'K7Q4MX29P3AB', 'uuid', 'Windows PC')).rejects.toMatchObject({ code: 'conflict' });

    const { candidates } = readCandidates(await api.importCandidates(claimed.id));
    const plan = (port = null) => api.importPlan(claimed.id, { folderToken: candidates[0].folderToken, name: 'Survival01', gamePort: port, memoryMiB: null, launchChoice: null, minecraftVersion: null }, 'key');
    const first = await plan();
    const blocked = await until(async () => { const job = await api.importJob(claimed.id, first.jobId); return job.state !== 'planning' && job; });
    expect(blocked.state).toBe('blocked');
    expect(blocked.review.blockers).toEqual(['source_running']);
    expect(blocked.review.confirmation).toBeNull();

    const second = await plan();
    const review = await until(async () => { const job = await api.importJob(claimed.id, second.jobId); return job.state !== 'planning' && job; });
    expect(review.state).toBe('review');
    const applied = await api.importApply(claimed.id, { planId: review.review.planId, confirmation: review.review.confirmation, acknowledgedWarnings: review.review.warnings, eulaAccepted: true, sourceStoppedConfirmed: true }, 'apply');
    expect((await api.importJob(claimed.id, applied.jobId)).state).toBe('applying');
    expect(await api.importCancel(claimed.id, applied.jobId, 'cancel')).toEqual({ state: 'cancelled' });
  }, 15_000);
});

describe('[hosts] import store', () => {
  test('a plan started from the store is sent at once and followed until the machine answers', async () => {
    const store = await import('../src/features/servers/hosts-store');
    const lan = await store.hostCommand((client) => client.discover());
    const ready = lan.find((entry) => entry.hostId === 'host-people');
    // Test files share the store, so another file may have set this machine up already.
    await store.hostCommand((client) => client.claim(ready.address, 'K7Q4MX29P3AB', 'uuid', 'Windows PC')).catch(() => {});
    await store.refreshHosts();
    const claimed = store.hosts().find((entry) => entry.id === ready.hostId);
    expect(claimed).toBeTruthy();

    const folder = { token: 'token:/home/eatham/servers/Survival', displayPath: '/home/eatham/servers/Survival' };
    const body = { folderToken: folder.token, name: 'Survival', gamePort: null, memoryMiB: null, launchChoice: null, minecraftVersion: null };
    await store.planAdd(claimed.id, { mode: 'import', folder, body }, 'Survival');
    expect(store.addTask(claimed.id)?.jobId).toBeTruthy();
    const blocked = await until(() => store.addTask(claimed.id)?.job?.review && store.addTask(claimed.id));
    expect(blocked.job.state).toBe('blocked');
    // Still under review: nothing is being copied yet, so the Servers list shows no banner.
    expect(store.activeAdds()).toEqual([]);
    store.clearAdd(claimed.id);
    expect(store.addTask(claimed.id)).toBeUndefined();
  }, 15_000);
});
