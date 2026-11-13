import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOST_PORT, blockerFix, canonicalCode, codeComplete, codeRejected, enrollProblem, formatCode, groupServers, hostIdOf, importPercent,
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

  test('a wrong or expired code says how to get a new one; other failures stay on the account step', () => {
    const wrong = { code: 'credentials_rejected', reason: 'pairing_failed' };
    expect(enrollProblem(wrong, 'claim')).toBe('vesta-server.problem.setup-code');
    expect(enrollProblem(wrong, 'link')).toBe('vesta-server.problem.link-code');
    expect(codeRejected(wrong)).toBe(true);
    expect(enrollProblem({ code: 'unreachable' }, 'claim')).toBe('vesta-server.problem.unreachable');
    expect(codeRejected({ code: 'unreachable' })).toBe(false);
    expect(enrollProblem({ code: 'internal', reason: 'account_verification_unavailable' }, 'claim')).toBe('vesta-server.problem.account');
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
