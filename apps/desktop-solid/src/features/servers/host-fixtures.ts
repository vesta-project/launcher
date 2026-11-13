// Browser preview stand in for the native Vesta Server commands. One machine on the LAN is
// ready to set up (code K7Q4-MX29-P3AB), another is already set up by someone else.
//
// Preview scenarios (localStorage, then reload):
//   vesta.fixtures.hosts  = 'none' (nothing yet) | 'one' (a machine, no servers) | 'servers' (a machine
//                           and servers) | 'two' (two machines) | 'offline' (a machine that isn't answering)
//   vesta.fixtures.import = 'none' (nothing found automatically)
import type { hostsNative, Folder, FolderCheck, HostDevice, HostDiscovery, HostInfo, HostServer, ImportJob, ImportReview, LinkResult, VestaHost } from './native-hosts';

export type HostsApi = typeof hostsNative;

/** A folder on the pretend machine. `has` lists the server parts inside; `files` are plain files. */
interface FixtureDir { dirs?: Record<string, FixtureDir>; files?: string[]; has?: ('server_properties' | 'server_jar' | 'world')[]; locked?: boolean; hidden?: boolean; protected?: boolean }

const SERVER = (extra: Record<string, FixtureDir> = {}): FixtureDir => ({
  has: ['server_properties', 'server_jar', 'world'], files: ['server.properties', 'server.jar', 'eula.txt'],
  dirs: { world: {}, logs: {}, config: {}, mods: {}, ...extra },
});

const MACHINE: FixtureDir = {
  dirs: {
    proc: { hidden: true }, sys: { hidden: true }, dev: { hidden: true }, boot: { hidden: true },
    etc: { dirs: { systemd: {}, ssh: { locked: true } } },
    home: {
      dirs: {
        eatham: {
          dirs: {
            'h12-import-test': { dirs: { Minecraft: SERVER() } },
            servers: { dirs: { Survival: SERVER({ plugins: {} }), Creative: SERVER(), backups: { dirs: { 'old-world': { has: ['world'], dirs: { region: {}, data: {} } } } } } },
            Downloads: { files: ['fabric-installer.jar'] },
          },
        },
        games: { locked: true, dirs: { Modded: SERVER() } },
      },
    },
    opt: { dirs: {} },
    srv: { dirs: { minecraft: { dirs: { lobby: { locked: true, dirs: {} } } } } },
    var: { dirs: { lib: { dirs: { vesta: { protected: true } } }, log: {} } },
  },
};
const SAVED_ROOT = '/home/eatham/h12-import-test/Minecraft';

const pathParts = (path: string) => path.split('/').filter(Boolean);
/** Walks a path: the folder, or why it stops (a locked folder on the way, a file, nothing). */
function walk(path: string): { dir: FixtureDir } | { stop: 'locked' | 'missing' | 'file' | 'protected' } {
  let dir = MACHINE;
  const names = pathParts(path);
  for (const [index, name] of names.entries()) {
    if (dir.locked) return { stop: 'locked' };
    const next = dir.dirs?.[name];
    if (!next || next.hidden) return { stop: index === names.length - 1 && dir.files?.includes(name) ? 'file' : 'missing' };
    if (next.protected) return { stop: 'protected' };
    dir = next;
  }
  return dir.locked ? { stop: 'locked' } : { dir };
}
const looksLikeServer = (dir: FixtureDir) => !!dir.has?.some((part) => part === 'server_properties' || part === 'server_jar');
const missingParts = (dir: FixtureDir) => (['server_properties', 'server_jar', 'world'] as const).filter((part) => !dir.has?.includes(part));
const commandFor = (path: string) => `sudo vesta import-root add '${path}'`;
const tokenPath = (token: string) => token.replace(/^token:/, '') || '/';
const joinFixture = (base: string, name: string) => (base === '/' ? `/${name}` : `${base}/${name}`);

const SETUP_CODE = 'K7Q4MX29P3AB';
const reject = (code: string, reason?: string) => Promise.reject({ code, ...(reason ? { reason } : {}) });
const clean = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FixtureJob extends ImportJob { startedAt: number; folder: string; name: string; port: number | null; memory: number | null; checks: number }

export function createHostFixtures(options: { hosts?: string | null; found?: string | null } = {}): HostsApi {
  const lan: HostDiscovery[] = [
    { hostId: 'host-people', name: 'people-server', fingerprint: 'a'.repeat(64), address: '192.168.1.67:25500', state: 'unclaimed' },
    { hostId: 'host-attic', name: 'attic-pc', fingerprint: 'b'.repeat(64), address: '192.168.1.80:25500', state: 'claimed' },
  ];
  const hosts: VestaHost[] = [];
  const servers = new Map<string, HostServer[]>();
  const devices = new Map<string, HostDevice[]>();
  const seeded = options.hosts && options.hosts !== 'none' ? (options.hosts === 'two' ? lan : lan.slice(0, 1)) : [];
  for (const found of seeded) {
    found.state = 'claimed';
    hosts.push({ id: found.hostId, name: found.name ?? found.address, fingerprint: found.fingerprint, endpoints: [found.address], deviceId: 'device-self', keyReference: 'fixture', accountId: 'fixture-account', authRevision: '1' });
    servers.set(found.hostId, []);
    devices.set(found.hostId, [{ deviceId: 'device-self', name: 'Windows PC', accountId: 'fixture-account', revoked: false, createdAt: new Date().toISOString() }]);
  }
  const offline = options.hosts === 'offline';
  const jobs = new Map<string, FixtureJob>();
  const links = new Map<string, { state: string; polls: number }>();
  let checks = 0;

  const host = (id: string) => hosts.find((entry) => entry.id === id);
  const need = (id: string) => (host(id) ? Promise.resolve(host(id)!) : reject('not_found'));
  const find = (address: string) => lan.find((entry) => entry.address.startsWith(address.replace(/:25500$/, '')) || entry.name === address);

  const review = (job: FixtureJob): ImportReview => {
    const found = walk(job.folder);
    const notServer = 'dir' in found && !looksLikeServer(found.dir);
    const blockers = notServer ? ['not_minecraft_server'] : job.checks === 0 ? ['source_running'] : job.port === 25565 ? ['game_port_in_use'] : [];
    return {
      planId: `plan-${job.jobId}-${job.checks}`, confirmation: blockers.length ? null : `confirm-${job.jobId}`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(), blockers, warnings: blockers.length ? [] : ['disable_amp_auto_restart'],
      source: { displayPath: job.folder, snapshot: 'f'.repeat(64), files: 1200, bytes: 1_843_200_000 },
      detected: { kind: 'minecraft', instanceName: job.name, minecraftVersion: '1.21.1', loader: 'fabric' },
      runtime: { requiredMajor: 21, downloadRequired: true, verified: true },
      destination: { serverId: `srv-${job.jobId}`, displayPath: '/var/lib/vesta/servers/new/game', freeBytes: 64_000_000_000 },
      resources: { gamePort: job.port ?? 25566, memoryMiB: job.memory ?? 4096 },
      processes: [], ports: [], inspection: { processes: 'complete', ports: 'complete', ...(notServer && 'dir' in found ? { missing: missingParts(found.dir) } : {}) },
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
    verifyCode: async (address, code, purpose) => {
      await wait(700);
      const found = find(address);
      if (!found) return reject('unreachable');
      if (purpose === 'claim' && found.state === 'claimed') return reject('conflict', 'host_already_claimed');
      if (purpose === 'claim' ? clean(code) !== SETUP_CODE : clean(code).length !== 12) return reject('credentials_rejected', 'pairing_failed');
      return { verificationId: 'verified-' + Date.now(), hostId: found.hostId, name: found.name };
    },
    claim: async (address, code, accountUuid, deviceName) => {
      await wait(900);
      const found = find(address);
      if (!found) return reject('unreachable');
      if (found.state === 'claimed') return reject('conflict', 'host_already_claimed');
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
    servers: async (hostId) => {
      await need(hostId);
      if (offline) { await wait(600); return reject('unreachable'); }
      return { servers: [...(servers.get(hostId) ?? [])], nextCursor: null };
    },
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
    // The saved root keeps the label an older machine gave it; the launcher names it by its folder.
    folderRoots: async (hostId) => {
      await need(hostId);
      return { roots: [{ rootId: 'top', label: '/', displayPath: '/', readable: true }, { rootId: 'saved-1', label: 'Import folder 1', displayPath: SAVED_ROOT, readable: true }], revision: '1' };
    },
    folderResolve: async (hostId, rootId, relativePath) => {
      await need(hostId);
      const base = rootId === 'top' ? '/' : SAVED_ROOT;
      const displayPath = relativePath ? joinFixture(base, relativePath) : base;
      const found = walk(displayPath);
      if (!('dir' in found)) return reject(found.stop === 'locked' ? 'forbidden' : 'not_found');
      return { folderToken: `token:${displayPath}`, displayPath, expiresAt: new Date(Date.now() + 600_000).toISOString() };
    },
    folderList: async (hostId, folderToken) => {
      await need(hostId);
      await wait(250);
      const displayPath = tokenPath(folderToken);
      const found = walk(displayPath);
      if (!('dir' in found)) return reject('not_found');
      const entries = Object.entries(found.dir.dirs ?? {}).filter(([, dir]) => !dir.hidden && !dir.protected)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, dir]): Folder => {
          const path = joinFixture(displayPath, name);
          return dir.locked
            ? { name, kind: 'directory', folderToken: null, readable: false, looksLikeServer: false, remediationCommand: commandFor(path) }
            : { name, kind: 'directory', folderToken: `token:${path}`, readable: true, looksLikeServer: looksLikeServer(dir) };
        });
      return { displayPath, entries, nextCursor: null };
    },
    folderCheck: async (hostId, path): Promise<FolderCheck> => {
      await need(hostId);
      await wait(350);
      const found = walk(path);
      if ('dir' in found) return { path, status: 'ok', folderToken: `token:${path}`, remediationCommand: null };
      const status = found.stop === 'locked' ? 'permission_needed' : found.stop === 'file' ? 'not_directory' : found.stop === 'protected' ? 'protected' : 'not_found';
      return { path, status, folderToken: null, remediationCommand: status === 'permission_needed' ? commandFor(path) : null };
    },
    importCandidates: async (hostId) => {
      await need(hostId);
      await wait(500);
      // An older machine also warns about default locations it can't read; the launcher ignores those.
      const warnings = [{ code: 'source_unreadable', displayPath: '/home', remediation: { command: commandFor('/home'), alternative: null } }];
      if (options.found === 'none') return { candidates: [], warnings };
      return {
        candidates: [
          { candidateId: 'c1', kind: 'minecraft', label: 'Survival', displayPath: '/home/eatham/servers/Survival', folderToken: 'token:/home/eatham/servers/Survival', loader: 'fabric', bytes: 1_843_200_000, confidence: 'high', evidence: [] },
          { candidateId: 'c2', kind: 'minecraft', label: 'Creative', displayPath: '/home/eatham/servers/Creative', folderToken: 'token:/home/eatham/servers/Creative', loader: 'paper', bytes: 412_000_000, confidence: 'high', evidence: [] },
          { candidateId: 'c3', kind: 'minecraft', label: 'Modded', displayPath: '/home/games/Modded', folderToken: null, remediationCommand: commandFor('/home/games/Modded'), confidence: 'medium', evidence: [] },
        ],
        warnings,
      };
    },
    importInspect: async (hostId, folderToken) => {
      await need(hostId);
      await wait(300);
      const found = walk(tokenPath(folderToken));
      if (!('dir' in found)) return reject('not_found');
      const missing = missingParts(found.dir);
      return looksLikeServer(found.dir) ? { blockers: [], missing, found: found.dir.has ?? [] } : { blockers: ['not_minecraft_server'], missing, found: found.dir.has ?? [] };
    },
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
