// Browser preview stand in for the native Vesta Server commands. One machine on the LAN is
// ready to set up (code K7Q4-MX29-P3AB), another is already set up by someone else.
import type { hostsNative, HostDevice, HostDiscovery, HostInfo, HostServer, ImportJob, ImportReview, LinkResult, VestaHost } from './native-hosts';

export type HostsApi = typeof hostsNative;

const SETUP_CODE = 'K7Q4MX29P3AB';
const reject = (code: string, reason?: string) => Promise.reject({ code, ...(reason ? { reason } : {}) });
const clean = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FixtureJob extends ImportJob { startedAt: number; folder: string; name: string; port: number | null; memory: number | null; checks: number }

export function createHostFixtures(): HostsApi {
  const lan: HostDiscovery[] = [
    { hostId: 'host-people', name: 'people-server', fingerprint: 'a'.repeat(64), address: '192.168.1.67:25500', state: 'unclaimed' },
    { hostId: 'host-attic', name: 'attic-pc', fingerprint: 'b'.repeat(64), address: '192.168.1.80:25500', state: 'claimed' },
  ];
  const hosts: VestaHost[] = [];
  const servers = new Map<string, HostServer[]>();
  const devices = new Map<string, HostDevice[]>();
  const jobs = new Map<string, FixtureJob>();
  const links = new Map<string, { state: string; polls: number }>();
  let checks = 0;

  const host = (id: string) => hosts.find((entry) => entry.id === id);
  const need = (id: string) => (host(id) ? Promise.resolve(host(id)!) : reject('not_found'));
  const find = (address: string) => lan.find((entry) => entry.address.startsWith(address.replace(/:25500$/, '')) || entry.name === address);

  const review = (job: FixtureJob): ImportReview => {
    const blockers = job.checks === 0 ? ['source_running'] : job.port === 25565 ? ['game_port_in_use'] : [];
    return {
      planId: `plan-${job.jobId}-${job.checks}`, confirmation: blockers.length ? null : `confirm-${job.jobId}`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(), blockers, warnings: blockers.length ? [] : ['disable_amp_auto_restart'],
      source: { displayPath: job.folder, snapshot: 'f'.repeat(64), files: 1200, bytes: 1_843_200_000 },
      detected: { kind: 'amp', instanceName: job.name, minecraftVersion: '1.21.1', loader: 'fabric' },
      runtime: { requiredMajor: 21, downloadRequired: true, verified: true },
      destination: { serverId: `srv-${job.jobId}`, displayPath: '/var/lib/vesta/servers/new/game', freeBytes: 64_000_000_000 },
      resources: { gamePort: job.port ?? 25566, memoryMiB: job.memory ?? 4096 },
      processes: [], ports: [], inspection: { processes: 'complete', ports: 'complete' },
    };
  };

  /** Moves a fixture job along by wall clock time, as the machine would. */
  const advance = (job: FixtureJob): FixtureJob => {
    const age = Date.now() - job.startedAt;
    if (job.state === 'planning' && age > 1200) {
      job.review = review(job);
      job.state = job.review.blockers.length ? 'blocked' : 'review';
    } else if (job.state === 'applying') {
      const total = job.review!.source.bytes;
      const done = Math.min(total, Math.round((age / 6000) * total));
      job.progress = { filesDone: Math.round((done / total) * 1200), filesTotal: 1200, bytesDone: done, bytesTotal: total };
      job.phase = done < total ? 'copy' : 'register';
      if (done >= total) job.state = 'ready';
    } else if (job.state === 'starting' && age > 2500) {
      job.state = 'online';
      job.phase = 'start';
    }
    return { ...job, review: job.review };
  };

  const jobFor = (hostId: string, id: string) => {
    const job = jobs.get(id);
    return job && host(hostId) ? Promise.resolve(advance(job)) : reject('not_found', 'import_job_not_found');
  };

  return {
    discover: async () => { await wait(700); return lan.map((entry) => ({ ...entry })); },
    probe: async (address) => { await wait(400); return find(address) ?? reject('unreachable'); },
    list: async () => hosts.map((entry) => ({ ...entry, endpoints: [...entry.endpoints] })),
    remove: async (hostId) => {
      const index = hosts.findIndex((entry) => entry.id === hostId);
      if (index < 0) return reject('not_found');
      hosts.splice(index, 1);
    },
    claim: async (address, code, accountUuid, deviceName) => {
      await wait(900);
      const found = find(address);
      if (!found) return reject('unreachable');
      if (found.state === 'claimed') return reject('conflict');
      if (clean(code) !== SETUP_CODE) return reject('credentials_rejected', 'pairing_failed');
      found.state = 'claimed';
      const added: VestaHost = { id: found.hostId, name: found.name ?? address, fingerprint: found.fingerprint, endpoints: [found.address], deviceId: 'device-self', keyReference: 'fixture', accountId: accountUuid, authRevision: '1' };
      hosts.push(added);
      devices.set(added.id, [{ deviceId: 'device-self', name: deviceName, accountId: accountUuid, revoked: false, createdAt: new Date().toISOString() }]);
      servers.set(added.id, []);
      return { ...added };
    },
    signIn: async (hostId) => {
      const found = await need(hostId);
      return { hostId, name: found.name, fingerprint: found.fingerprint, endpoints: found.endpoints, authGeneration: '1', capabilities: ['imports'], role: 'primary_owner', revision: '1' };
    },
    linkStart: async (address, code) => {
      await wait(700);
      if (!find(address)) return reject('unreachable');
      if (clean(code).length !== 12) return reject('credentials_rejected', 'pairing_failed');
      const linkId = `link-${Date.now()}`;
      links.set(linkId, { state: 'requested', polls: 0 });
      return { linkId, state: 'requested', requestHash: 'hash' };
    },
    linkPoll: async (linkId) => {
      const link = links.get(linkId);
      if (!link) return reject('not_found');
      link.polls += 1;
      return { linkId, state: link.polls > 3 ? 'denied' : 'requested', requestHash: 'hash' } satisfies LinkResult;
    },
    servers: async (hostId) => { await need(hostId); return { servers: [...(servers.get(hostId) ?? [])], nextCursor: null }; },
    info: async (hostId): Promise<HostInfo> => {
      const found = await need(hostId);
      return { hostId, name: found.name, fingerprint: found.fingerprint, endpoints: found.endpoints, authGeneration: '1', capabilities: ['imports'], role: 'primary_owner', revision: '1' };
    },
    devices: async (hostId) => { await need(hostId); return { devices: [...(devices.get(hostId) ?? [])], nextCursor: null }; },
    linkCode: async (hostId) => { await need(hostId); const linkId = `issued-${Date.now()}`; links.set(linkId, { state: 'waiting', polls: 0 }); return { linkId, code: 'R2D2C3P0BB8X', expiresAt: new Date(Date.now() + 600_000).toISOString() }; },
    linkStatus: async (hostId, id) => {
      await need(hostId);
      const link = links.get(id);
      if (!link) return reject('not_found');
      link.polls += 1;
      if (link.state === 'waiting' && link.polls > 2) link.state = 'requested';
      return { linkId: id, state: link.state, requestHash: link.state === 'requested' ? 'hash' : '' };
    },
    linkApprove: async (hostId, id) => {
      await need(hostId);
      const link = links.get(id);
      if (!link) return reject('not_found');
      link.state = 'approved';
      devices.get(hostId)?.push({ deviceId: `device-${id}`, name: 'Laptop', accountId: host(hostId)!.accountId, revoked: false, createdAt: new Date().toISOString() });
    },
    deviceRevoke: async (hostId, id) => {
      await need(hostId);
      const list = devices.get(hostId) ?? [];
      devices.set(hostId, list.filter((device) => device.deviceId !== id));
    },
    ownerChange: async () => reject('unsupported'),
    folderRoots: async (hostId) => { await need(hostId); return { roots: [{ rootId: 'amp', label: 'AMP instances', displayPath: '/home/amp/.ampdata/instances', readable: true }, { rootId: 'imports', label: 'Imports', displayPath: '/srv/vesta-imports', readable: true }], revision: '1' }; },
    folderResolve: async (hostId, rootId, relativePath) => {
      await need(hostId);
      const base = rootId === 'amp' ? '/home/amp/.ampdata/instances' : '/srv/vesta-imports';
      const displayPath = relativePath ? `${base}/${relativePath}` : base;
      return { folderToken: `token:${displayPath}`, displayPath, expiresAt: new Date(Date.now() + 600_000).toISOString() };
    },
    folderList: async (hostId, folderToken) => {
      await need(hostId);
      await wait(250);
      const displayPath = folderToken.replace(/^token:/, '');
      const names = displayPath.endsWith('instances') ? ['Survival01', 'Creative01'] : displayPath.endsWith('01') ? ['Minecraft'] : displayPath.endsWith('Minecraft') ? ['world', 'mods', 'config'] : [];
      return { displayPath, entries: names.map((name) => ({ name, kind: 'directory' as const, folderToken: `token:${displayPath}/${name}`, readable: true })), nextCursor: null };
    },
    importCandidates: async (hostId) => {
      await need(hostId);
      await wait(500);
      return {
        candidates: [
          { candidateId: 'c1', kind: 'amp', label: 'Survival01', displayPath: '/home/amp/.ampdata/instances/Survival01/Minecraft', folderToken: 'token:/home/amp/.ampdata/instances/Survival01/Minecraft', confidence: 'high', evidence: [] },
          { candidateId: 'c2', kind: 'minecraft', label: 'old-world', displayPath: '/srv/vesta-imports/old-world', folderToken: 'token:/srv/vesta-imports/old-world', confidence: 'medium', evidence: [] },
        ],
        warnings: [{ code: 'source_unreadable', displayPath: '/home/amp/.ampdata/instances/Modded02/Minecraft', remediation: { command: 'sudo vesta import-root add /home/amp/.ampdata/instances/Modded02/Minecraft', alternative: null } }],
      };
    },
    importInspect: async () => reject('unsupported'),
    importResources: async () => reject('unsupported'),
    importPlan: async (hostId, body) => {
      await need(hostId);
      const jobId = `job-${Date.now()}`;
      jobs.set(jobId, { jobId, state: 'planning', phase: 'inspect', error: null, progress: { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }, review: null, serverId: null, startedAt: Date.now(), folder: body.folderToken.replace(/^token:/, ''), name: body.name, port: body.gamePort, memory: body.memoryMiB, checks: checks++ });
      return { jobId, state: 'planning' };
    },
    importApply: async (hostId, body) => {
      await need(hostId);
      const job = [...jobs.values()].find((entry) => entry.review?.planId === body.planId);
      if (!job || job.review?.confirmation !== body.confirmation) return reject('conflict', 'source_changed');
      Object.assign(job, { state: 'applying', phase: 'copy', startedAt: Date.now(), serverId: job.review.destination.serverId });
      return { jobId: job.jobId, serverId: job.serverId! };
    },
    importJob: (hostId, id) => jobFor(hostId, id),
    importCancel: async (hostId, id) => {
      const job = jobs.get(id);
      if (!job || !host(hostId)) return reject('not_found', 'import_job_not_found');
      job.state = 'cancelled';
      return { state: job.state };
    },
    importResume: async (hostId, id) => {
      const job = jobs.get(id);
      if (!job || !host(hostId)) return reject('not_found', 'import_job_not_found');
      Object.assign(job, { state: 'applying', startedAt: Date.now() });
      return advance(job);
    },
    importStart: async (hostId, id) => {
      const job = jobs.get(id);
      if (!job || !host(hostId)) return reject('not_found', 'import_job_not_found');
      Object.assign(job, { state: 'starting', phase: 'start', startedAt: Date.now() });
      servers.get(hostId)?.push({ serverId: job.serverId!, name: job.name, gamePort: job.review!.resources.gamePort, state: 'running', role: 'owner' });
      return advance(job);
    },
    importReadiness: (hostId, id) => jobFor(hostId, id),
  };
}
