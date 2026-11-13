import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CODE_ALPHABET, CODE_GROUPS, CODE_LENGTH, HOST_PORT, backspaceCode, blockerFix, canonicalCode, codeChar, codeComplete, codeGroups, codeProblem, enrollProblemForFind,
  formatCode, groupServers, hostIdOf, importPercent, setupProblem, typeIntoCode, waitSeconds,
  importRootCommand, keepKey, machineState, parseVestaAddress, readCandidates, reviewSummary, sortDiscovered,
} from '../src/features/servers/host-model';
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
  test('machines this device is linked to sign in; claimed ones need a link code; ready ones list first', () => {
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

  test('the native layer names each cause instead of collapsing them', () => {
    const native = readFileSync(join(root, '../../vesta-launcher/src-tauri/src/servers/hosts.rs'), 'utf8');
    const client = readFileSync(join(root, '../../crates/vesta-server-client/src/host.rs'), 'utf8');
    for (const reason of ['account_signin_required', 'account_service_unreachable', 'account_proof_failed', 'code_expired'])
      expect(native + client, reason).toContain(`"${reason}"`);
    expect(client).toContain('"host_already_claimed"');
    expect(client).toContain('"pairing_failed"');
    // The code is never logged.
    expect(native).not.toMatch(/log::[a-z]+!\([^)]*code/);
  });
});

describe('[hosts] import review', () => {
  test('every blocker has a plain fix; permission shows the exact command for the machine', () => {
    expect(blockerFix('source_running', '/x').message).toBe('vesta-server.blocker.source-running');
    expect(blockerFix('source_unreadable', '/home/amp/.ampdata/instances/Survival01/Minecraft').command)
      .toBe('sudo vesta import-root add /home/amp/.ampdata/instances/Survival01/Minecraft');
    expect(importRootCommand('/srv/my server')).toBe('sudo vesta import-root add "/srv/my server"');
    expect(importRootCommand('D:\\mc\\survival')).toBe('vesta import-root add D:\\mc\\survival');
    expect(blockerFix('game_port_in_use', '/x')).toMatchObject({ message: 'vesta-server.blocker.port-in-use', customize: true });
    expect(blockerFix('insufficient_space', '/x').message).toBe('vesta-server.blocker.disk');
    expect(blockerFix('software_unresolved', '/x').message).toBe('vesta-server.blocker.software');
    expect(blockerFix('brand_new_code', '/x').message).toBe('vesta-server.blocker.other');
  });

  test('candidates put AMP first and drop malformed rows; warnings keep remediation commands', () => {
    const read = readCandidates({
      candidates: [
        { candidateId: '1', kind: 'minecraft', label: 'zeta', displayPath: '/srv/zeta', folderToken: 't1' },
        { candidateId: '2', kind: 'amp', displayPath: '/home/amp/.ampdata/instances/Survival01/Minecraft', folderToken: 't2' },
        { kind: 'amp' },
        null,
      ],
      warnings: [{ code: 'source_unreadable', displayPath: '/p', remediation: { command: 'sudo vesta import-root add /p' } }, { nope: 1 }],
    });
    expect(read.candidates.map((entry) => entry.label)).toEqual(['Survival01', 'zeta']);
    expect(read.warnings).toEqual([{ code: 'source_unreadable', displayPath: '/p', command: 'sudo vesta import-root add /p' }]);
    expect(readCandidates(null)).toEqual({ candidates: [], warnings: [] });
  });

  test('the summary reads software, version, size and port; progress prefers bytes', () => {
    const review = {
      source: { displayPath: '/x', files: 10, bytes: 2048 }, destination: { freeBytes: 9 }, resources: { gamePort: 25566, memoryMiB: 4096 },
      detected: { minecraftVersion: '1.21.1', loader: 'fabric', instanceName: 'Survival' }, runtime: { requiredMajor: 21 },
    };
    expect(reviewSummary(review)).toMatchObject({ software: 'Fabric', minecraftVersion: '1.21.1', bytes: 2048, gamePort: 25566, javaMajor: 21 });
    expect(reviewSummary({ ...review, detected: { minecraftVersion: '1.20.1' } }).software).toBe('Vanilla');
    expect(reviewSummary({ ...review, detected: null, runtime: null }).software).toBeNull();
    expect(importPercent({ filesDone: 1, filesTotal: 4, bytesDone: 50, bytesTotal: 100 })).toBe(50);
    expect(importPercent({ filesDone: 1, filesTotal: 4, bytesDone: 0, bytesTotal: 0 })).toBe(25);
    expect(importPercent(null)).toBeNull();
    expect(keepKey({ code: 'outcome_unknown' })).toBe(true);
    expect(keepKey({ code: 'conflict' })).toBe(false);
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

  test('the old per server pairing screen is gone and setup replaces Add server', () => {
    const page = source('src/pages/servers/servers-page.tsx');
    expect(page).not.toContain('AddServer');
    expect(page).toContain('<VestaSetup />');
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

describe('[hosts] fixture flow', () => {
  test('claim, check a running AMP server, check again, copy and cancel', async () => {
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
    const ready = lan.find((entry) => entry.state === 'unclaimed');
    const claimed = await store.hostCommand((client) => client.claim(ready.address, 'K7Q4MX29P3AB', 'uuid', 'Windows PC'));
    await store.refreshHosts();
    expect(store.hosts().map((entry) => entry.id)).toContain(claimed.id);

    const folder = { token: 'token:/home/amp/.ampdata/instances/Survival01/Minecraft', displayPath: '/home/amp/.ampdata/instances/Survival01/Minecraft' };
    await store.planImport(claimed.id, { folder, name: 'Survival01', gamePort: null, memoryMiB: null });
    expect(store.importTask(claimed.id)?.jobId).toBeTruthy();
    const blocked = await until(() => store.importTask(claimed.id)?.job?.review && store.importTask(claimed.id));
    expect(blocked.job.state).toBe('blocked');
    // Still under review: nothing is being copied yet, so the Servers list shows no banner.
    expect(store.activeImports()).toEqual([]);
    store.clearImport(claimed.id);
    expect(store.importTask(claimed.id)).toBeUndefined();
  }, 15_000);
});
