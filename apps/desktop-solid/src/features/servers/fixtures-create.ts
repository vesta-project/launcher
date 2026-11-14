// Browser preview stand in for creating a server on a Vesta Server machine (create.md).
// Something else already listens on 25565, so the suggested port is 25566 and choosing 25565
// shows a port conflict. Downloads move slowly enough to watch.
//
// Preview scenarios (localStorage `vesta.fixtures.create`, then reload):
//   'interrupt' the machine restarts halfway through the download, so the job waits to resume
//   'fail'      installing fails, so the job ends with an error
//   'restore'   the machine also has backups to restore from
//   'old'       an older machine that can only import
import type {
  CatalogueKind, CreateApply, CreateJob, CreatePlan, CreateReview, HostServer, ImportState, MinecraftCatalogue, RestoreSource, SoftwareCatalogue,
} from './native-hosts';

const reject = (code: string, reason?: string) => Promise.reject({ code, ...(reason ? { reason } : {}) });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MIB = 1024 * 1024;

const VERSIONS: MinecraftCatalogue = {
  latestStable: '1.21.4',
  versions: [
    { id: '25w05a', stable: false, experimental: true, recommended: false },
    { id: '1.21.5-pre1', stable: false, experimental: true, recommended: false },
    ...['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9']
      .map((id) => ({ id, stable: true, experimental: false, recommended: id === '1.21.4' })),
  ],
};

const minor = (version: string) => Number(/^1\.(\d+)/.exec(version)?.[1] ?? 99);
const patch = (version: string) => Number(/^1\.\d+\.(\d+)/.exec(version)?.[1] ?? 0);

/** What each software offers for a version, newest build first. */
function catalogue(version: string): SoftwareCatalogue {
  const entry = VERSIONS.versions.find((candidate) => candidate.id === version);
  const snapshot = !!entry?.experimental;
  const at = minor(version);
  const kind = (id: string, label: string, builds: { build?: number; loader?: string }[], extra: Partial<CatalogueKind> & { unavailableReason?: string } = {}): CatalogueKind => {
    const experimental = snapshot || id === 'folia';
    return {
      kind: id, label, stable: !experimental, experimental, recommended: id === 'vanilla' && !experimental, available: builds.length > 0 && !extra.unavailableReason,
      builds: builds.map((build, index) => ({
        id: `${id}-${version}-${build.build ?? build.loader ?? 'release'}`, build: build.build ?? null, loaderVersion: build.loader ?? null,
        stable: !experimental, experimental, recommended: index === 0 && !experimental,
      })),
      ...extra,
    };
  };
  const paperBuilds = (top: number) => Array.from({ length: 6 }, (_, index) => ({ build: top - index }));
  return {
    minecraftVersion: version,
    kinds: [
      kind('vanilla', 'Vanilla', [{}]),
      kind('paper', 'Paper', snapshot ? [] : paperBuilds(130 + patch(version))),
      kind('folia', 'Folia', !snapshot && at >= 20 ? paperBuilds(12) : []),
      kind('purpur', 'Purpur', !snapshot && at >= 16 ? paperBuilds(2380) : []),
      kind('fabric', 'Fabric', at >= 14 ? [{ loader: '0.16.10' }, { loader: '0.16.9' }, { loader: '0.15.11' }] : []),
      kind('quilt', 'Quilt', !snapshot && at >= 18 ? [{ loader: '0.27.1' }, { loader: '0.26.4' }] : []),
      // The Forge download site is offline for the newest release, so it says so in a word.
      kind('forge', 'Forge', snapshot ? [] : [{ loader: '54.0.16' }, { loader: '54.0.12' }], version === '1.21.4' ? { unavailableReason: 'provider_unavailable' } : {}),
      kind('neoforge', 'NeoForge', !snapshot && at >= 20 && (at > 20 || patch(version) >= 2) ? [{ loader: '21.4.75' }, { loader: '21.4.70' }] : []),
      kind('bukkit', 'CraftBukkit', snapshot ? [] : [{}]),
      kind('spigot', 'Spigot', snapshot ? [] : [{}]),
    ],
  };
}

interface CreateFixtureJob extends CreateJob {
  startedAt: number;
  plan: CreatePlan;
  /** Milliseconds of work already done before the latest resume. */
  doneMs: number;
  interrupted: boolean;
}

/** Wall clock milestones of one create job: what the machine is doing after `ms` of work. */
const TIMELINE = [
  { phase: 'resolving', until: 1500, bytes: 0, files: 0 },
  { phase: 'downloading_java', until: 5000, bytes: 46 * MIB, files: 0 },
  { phase: 'downloading_software', until: 14_000, bytes: 58 * MIB, files: 0 },
  { phase: 'installing', until: 17_000, bytes: 0, files: 240 },
  { phase: 'registering', until: 18_000, bytes: 0, files: 0 },
] as const;

export interface CreateFixtureHost {
  servers: (hostId: string) => HostServer[] | undefined;
  exists: (hostId: string) => boolean;
}

export function createCreateFixtures(scenario: string | null, host: CreateFixtureHost) {
  const jobs = new Map<string, CreateFixtureJob>();
  let sequence = 0;
  /** Another program on the machine already listens here. */
  const occupied = new Set([25565]);
  const TOTAL_MIB = 16_384;
  const BUDGET_MIB = 12_288;

  const reservedPorts = (hostId: string) => new Set([...occupied, ...(host.servers(hostId) ?? []).map((server) => server.gamePort),
    ...[...jobs.values()].filter((job) => job.state !== 'cancelled' && job.state !== 'failed' && job.serverId).map((job) => job.plan.gamePort ?? 0)]);
  const reservedMemory = (hostId: string) => [...jobs.values()].filter((job) => job.serverId && job.state !== 'cancelled' && job.state !== 'failed')
    .reduce((sum, job) => sum + (job.plan.memoryMiB ?? 0), 0)
    + (host.servers(hostId) ?? []).filter((server) => ![...jobs.values()].some((job) => job.serverId === server.serverId)).length * 2048;
  const freePort = (hostId: string) => { const taken = reservedPorts(hostId); let port = 25565; while (taken.has(port)) port += 1; return port; };
  const freeName = (hostId: string) => {
    const names = new Set([...(host.servers(hostId) ?? []).map((server) => server.name), ...[...jobs.values()].filter((job) => job.serverId).map((job) => job.plan.name)]);
    let name = 'Minecraft Server';
    for (let index = 2; names.has(name); index += 1) name = `Minecraft Server ${index}`;
    return name;
  };
  const available = (hostId: string) => Math.max(0, BUDGET_MIB - reservedMemory(hostId));
  const need = (hostId: string) => (host.exists(hostId) ? Promise.resolve() : reject('not_found'));
  const findJob = (hostId: string, id: string) => {
    const job = jobs.get(id);
    return job && host.exists(hostId) ? job : null;
  };

  const review = (hostId: string, job: CreateFixtureJob): CreateReview => {
    const plan = job.plan;
    const port = plan.gamePort ?? freePort(hostId);
    const memory = plan.memoryMiB ?? Math.min(4096, available(hostId));
    const blockers: string[] = [];
    const names = new Set((host.servers(hostId) ?? []).map((server) => server.name));
    if (names.has(plan.name.trim())) blockers.push('name_in_use');
    if (reservedPorts(hostId).has(port)) blockers.push('game_port_in_use');
    if (memory < 512) blockers.push('memory_invalid');
    else if (memory > available(hostId)) blockers.push('memory_budget_exceeded');
    const version = plan.kind === 'new' ? plan.minecraftVersion : '1.21.1';
    const software = plan.kind === 'new' ? plan.software : { kind: 'fabric', build: null, loaderVersion: '0.16.9' };
    const kinds = catalogue(version).kinds;
    const kind = kinds.find((entry) => entry.kind === software.kind);
    const build = kind?.builds.find((entry) => entry.build === software.build && entry.loaderVersion === software.loaderVersion)
      ?? kind?.builds.find((entry) => entry.recommended) ?? kind?.builds[0];
    if (!kind?.available || !build) blockers.push('software_unresolved');
    const warnings = !blockers.length && (kind?.experimental || build?.experimental) ? ['experimental_software'] : [];
    // Mojang publishes SHA-1 digests only, so Vanilla always carries this.
    if (!blockers.length && software.kind === 'vanilla') warnings.push('legacy_checksum');
    if (plan.kind === 'restore' && !blockers.length) warnings.push('restore_version_unknown');
    const serverId = `srv-${job.jobId}`;
    return {
      planId: `plan-${job.jobId}`, confirmation: blockers.length ? null : `confirm-${job.jobId}`, expiresAt: new Date(Date.now() + 600_000).toISOString(),
      blockers, warnings,
      summary: {
        kind: plan.kind, name: plan.name, minecraftVersion: version,
        software: { kind: software.kind, version, build: build?.build ?? null, loaderVersion: build?.loaderVersion ?? null },
        resources: { gamePort: port, memoryMiB: memory },
        runtime: { requiredMajor: minor(version) >= 21 || version.includes('w') ? 21 : minor(version) >= 18 ? 17 : 8, downloadRequired: true, automatic: true },
        destination: { serverId, displayPath: `/var/lib/vesta/servers/${serverId}/game`, freeBytes: 182_000_000_000 },
        pack: null,
        restore: plan.kind === 'restore' && plan.source.kind === 'snapshot' ? { sourceId: plan.source.sourceId, label: 'Survival', createdAt: '2026-11-12T21:04:00Z' } : null,
      },
    };
  };

  /** Moves a job along by wall clock time, as the machine would. */
  const advance = (hostId: string, job: CreateFixtureJob): CreateJob => {
    const age = Date.now() - job.startedAt;
    if (job.state === 'planning' && age > 1200) {
      job.review = review(hostId, job);
      job.state = job.review.blockers.length ? 'blocked' : 'review';
    } else if (job.state === 'applying') {
      const worked = job.doneMs + age;
      if (scenario === 'interrupt' && !job.interrupted && worked > 9000) {
        Object.assign(job, { state: 'interrupted', interrupted: true, doneMs: 9000, error: 'interrupted' });
      } else if (scenario === 'fail' && worked > 15_000) {
        Object.assign(job, { state: 'failed', phase: 'installing', error: 'install_failed' });
      } else {
        const at = TIMELINE.findIndex((step) => worked < step.until);
        if (at < 0) {
          Object.assign(job, { state: 'ready', phase: 'registering', progress: { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 } });
          const list = host.servers(hostId);
          if (list && !list.some((server) => server.serverId === job.serverId)) {
            const summary = job.review!.summary;
            list.push({
              serverId: job.serverId!, name: summary.name, gamePort: summary.resources.gamePort, state: 'stopped', role: 'owner',
              software: { kind: summary.software!.kind, version: summary.software!.loaderVersion ?? (summary.software!.build === null ? null : String(summary.software!.build)) },
              minecraftVersion: summary.minecraftVersion, iconEtag: null,
            });
          }
        } else {
          const step = TIMELINE[at]!;
          const from = at === 0 ? 0 : TIMELINE[at - 1]!.until;
          const share = (worked - from) / (step.until - from);
          job.phase = step.phase;
          job.progress = {
            bytesDone: Math.round(step.bytes * share), bytesTotal: step.bytes,
            filesDone: Math.round(step.files * share), filesTotal: step.files,
          };
        }
      }
    } else if (job.state === 'starting' && age > 3000) {
      job.state = 'online';
      const server = host.servers(hostId)?.find((entry) => entry.serverId === job.serverId);
      if (server) server.state = 'running';
    }
    const { startedAt: _started, plan: _plan, doneMs: _done, interrupted: _interrupted, ...envelope } = job;
    return structuredClone(envelope);
  };

  const transition = (hostId: string, id: string, from: ImportState[], change: Partial<CreateFixtureJob>) => {
    const job = findJob(hostId, id);
    if (!job) return reject('not_found', 'create_job_not_found');
    if (!from.includes(job.state)) return reject('conflict', 'conflict');
    Object.assign(job, change);
    return Promise.resolve(advance(hostId, job));
  };

  const sources: RestoreSource[] = [
    { sourceId: 'snap-survival', label: 'Survival', createdAt: '2026-11-12T21:04:00Z', minecraftVersion: '1.21.1', software: { kind: 'fabric', version: '0.16.9' }, bytes: 1_843_200_000 },
    { sourceId: 'snap-creative', label: 'Creative', createdAt: '2026-10-30T09:15:00Z', minecraftVersion: '1.20.4', software: { kind: 'paper', version: '497' }, bytes: 412_000_000 },
  ];

  return {
    catalogueMinecraft: async (hostId: string) => { await need(hostId); await wait(250); return structuredClone(VERSIONS); },
    catalogueSoftware: async (hostId: string, minecraftVersion: string) => {
      await need(hostId);
      await wait(700);
      if (!VERSIONS.versions.some((version) => version.id === minecraftVersion)) return reject('invalid_input', 'invalid_request');
      return catalogue(minecraftVersion);
    },
    createDefaults: async (hostId: string) => {
      await need(hostId);
      await wait(300);
      if (scenario === 'old') return reject('not_found', 'not_found');
      return { name: freeName(hostId), minecraftVersion: VERSIONS.latestStable!, software: { kind: 'vanilla', build: null, loaderVersion: null }, gamePort: freePort(hostId), memoryMiB: Math.min(4096, available(hostId)), java: 'automatic' as const };
    },
    createRestoreSources: async (hostId: string) => {
      await need(hostId);
      if (scenario !== 'restore') return reject('not_found', 'not_found');
      return { sources: structuredClone(sources) };
    },
    /** The resource preview the import routes already have, shared with creating. */
    resources: async (hostId: string, gamePort: number | null, memoryMiB: number | null) => {
      await need(hostId);
      await wait(150);
      const spare = available(hostId);
      const port = gamePort ?? freePort(hostId);
      const memory = memoryMiB ?? Math.min(4096, spare);
      return {
        memory: { totalMib: TOTAL_MIB, osReserveMib: TOTAL_MIB - BUDGET_MIB, budgetMib: BUDGET_MIB, reservedMib: reservedMemory(hostId), availableMib: spare, memoryMib: memory, status: 'resolved', blocker: memory < 512 ? 'memory_invalid' : memory > spare ? 'memory_budget_exceeded' : null },
        port: { gamePort: port, status: 'resolved', blocker: reservedPorts(hostId).has(port) ? 'game_port_in_use' : null },
      };
    },
    createPlan: async (hostId: string, body: CreatePlan) => {
      await need(hostId);
      await wait(200);
      if (body.kind === 'modpack' || (body.kind === 'restore' && body.source.kind === 'upload')) return reject('unsupported', 'not_supported_yet');
      if (!body.name.trim()) return reject('invalid_input', 'invalid_request');
      const jobId = `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
      jobs.set(jobId, {
        jobId, state: 'planning', phase: 'resolving', error: null, progress: { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }, review: null, serverId: null,
        startedAt: Date.now(), plan: structuredClone(body), doneMs: 0, interrupted: false,
      });
      return { jobId, state: 'planning' as const };
    },
    createApply: async (hostId: string, body: CreateApply) => {
      await need(hostId);
      await wait(250);
      if (!body.eulaAccepted) return reject('invalid_input', 'eula_required');
      const job = [...jobs.values()].find((entry) => entry.review?.planId === body.planId);
      if (!job || job.state !== 'review') return reject('conflict', 'plan_expired');
      if (job.review?.confirmation !== body.confirmation) return reject('conflict', 'confirmation_invalid');
      if (!job.review.warnings.every((code) => body.acknowledgedWarnings.includes(code))) return reject('invalid_input', 'warnings_unacknowledged');
      const serverId = job.review.summary.destination.serverId;
      Object.assign(job, { state: 'applying', phase: 'resolving', startedAt: Date.now(), doneMs: 0, serverId, review: { ...job.review, confirmation: null } });
      return { jobId: job.jobId, serverId };
    },
    createJob: async (hostId: string, id: string) => {
      const job = findJob(hostId, id);
      return job ? advance(hostId, job) : reject('not_found', 'create_job_not_found');
    },
    createCancel: async (hostId: string, id: string) => {
      const job = findJob(hostId, id);
      if (!job) return reject('not_found', 'create_job_not_found');
      if (['ready', 'starting', 'online'].includes(job.state)) return reject('conflict', 'conflict');
      job.state = 'cancelled';
      return { state: job.state };
    },
    createResume: (hostId: string, id: string) => {
      const job = findJob(hostId, id);
      return transition(hostId, id, ['interrupted'], { state: 'applying', error: null, startedAt: Date.now(), doneMs: job?.doneMs ?? 0 });
    },
    createStart: (hostId: string, id: string) => transition(hostId, id, ['ready'], { state: 'starting', phase: 'starting', error: null, startedAt: Date.now() }),
  };
}
