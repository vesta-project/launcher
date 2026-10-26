import type { ServerJavaInventory, ServerJavaRuntime } from './native-java';
// Fixture world, software and SFTP management for browser previews and checks. It keeps
// the agent rules the UI depends on: owner-only writes, a stopped game for world and
// software changes, exact world-name and revision checks, plans that expire, jobs that
// advance through staging and activation, and public-key-only SSH registrations.
import type { ConnectionId, ServerCommandError } from './native';
import type {
  ServerWorld, SftpConfigPatch, SftpKey, SftpStatus, SftpTarget, SoftwareDescriptor, SoftwareId, SoftwareJob, SoftwarePlan,
  SoftwarePlanRequest, SoftwareState, SoftwareVersions,
} from './hosting-native';
import { SOFTWARE_IDS } from './hosting-native';
import { hostOf, publicKeyComment, publicKeyProblem } from './hosting-model';

interface HostingHost {
  server(id: ConnectionId): { snapshot: { status: { state: string; generation: string | null } | null; connection: { role: string | null; endpoint: string } } };
  requireCapability(target: ReturnType<HostingHost['server']>, capability: string): void;
  wait(ms?: number): Promise<unknown>;
  datapackOperation(id: ConnectionId, command: string): import('./native').ServerOperation;
}

const fail = (code: ServerCommandError['code'], reason?: string): never => {
  throw { code, retryAfterMs: null, reason: reason ?? null } satisfies ServerCommandError;
};
const clone = <T,>(value: T): T => structuredClone(value);
const hex = (length: number) => Array.from({ length }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const base64 = (length: number) => Array.from({ length }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[Math.floor(Math.random() * 64)]).join('');

const VERSIONS: Record<SoftwareId, string[]> = {
  vanilla: ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2'],
  paper: ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1'],
  folia: ['1.21.4', '1.20.6', '1.20.4'],
  purpur: ['1.21.4', '1.21.3', '1.21.1', '1.20.6'],
  fabric: ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.1'],
  quilt: ['1.21.1', '1.20.6', '1.20.1'],
  forge: [],
  neoforge: [],
};
const AUTOMATIC: ReadonlySet<SoftwareId> = new Set(['vanilla', 'paper', 'folia', 'purpur', 'fabric', 'quilt']);
const catalog: SoftwareDescriptor[] = SOFTWARE_IDS.map((software) => ({
  software,
  automaticBackend: AUTOMATIC.has(software),
  unavailableReason: AUTOMATIC.has(software) ? null : 'provider_not_implemented',
  source: `https://example.invalid/${software}`,
  licence: software === 'vanilla' ? 'Minecraft EULA' : 'Open source',
  eula: 'https://www.minecraft.net/eula',
  caution: software === 'folia' ? 'region_threading_compatibility' : null,
}));
const javaFor = (version: string) => (/^1\.(2[1-9]|20\.[5-9])/.test(version) ? 21 : /^1\.(1[89]|20)/.test(version) ? 17 : 8);

interface HostingState {
  java: ServerJavaInventory;
  world: ServerWorld;
  worlds: string[];
  software: SoftwareState;
  plans: Map<string, { plan: SoftwarePlan; request: SoftwarePlanRequest; used: boolean }>;
  jobs: SoftwareJob[];
  intents: Map<string, { payload: string; result: unknown }>;
  sftp: SftpStatus;
  keys: SftpKey[];
}

function seed(): HostingState {
  const now = Date.now();
  return {
    java: { runtimes: [17, 21, 25].map(major => ({ id: `java-${major}`, path: `C:/Program Files/Eclipse Adoptium/jdk-${major}/bin/java.exe`, version: `${major}.0.3`, major, vendor: major === 17 ? 'Microsoft' : 'Eclipse Adoptium', arch: 'amd64', managed: false })), selected: { id: 'java-21', path: 'C:/Program Files/Eclipse Adoptium/jdk-21/bin/java.exe', version: '21.0.3', major: 21, vendor: 'Eclipse Adoptium', arch: 'amd64', managed: false }, customPathsAllowed: true, managedMajors: [] },
    world: { sizeBytes: '2846072184', sizeComplete: true, sizeObservedAtMs: now - 12_000, lastModifiedAtMs: now - 18_000, lastPlayedAtMs: now - 48_000, dimensions: [{ id: 'overworld', present: true, folders: ['world'], layout: 'nested' }, { id: 'nether', present: true, folders: ['world_nether/DIM-1'], layout: 'split' }, { id: 'end', present: true, folders: ['world_the_end/DIM1'], layout: 'split' }], datapacks: [{ id: 'vanilla', name: 'Vanilla', kind: 'builtin', path: null, enabled: true }, { id: 'file/terralith.zip', name: 'terralith.zip', kind: 'zip', path: 'world/datapacks/terralith.zip', enabled: true }, { id: 'file/seasonal', name: 'seasonal', kind: 'folder', path: 'world/datapacks/seasonal', enabled: false }, { id: 'file/new-pack.zip', name: 'new-pack.zip', kind: 'zip', path: 'world/datapacks/new-pack.zip', enabled: null }], datapackStateSource: 'saved_level_dat', name: 'world', seed: '-4172144997902289642', configuredSeed: '', exists: true, revision: '3' },
    worlds: ['world'],
    software: {
      available: true, unavailableReason: null, revision: '2',
      current: { software: 'paper', version: '1.21.1', build: 130, installationId: `inst-${hex(8)}`, javaMajor: 21 },
      previous: { software: 'vanilla', version: '1.21.1', build: null, installationId: `inst-${hex(8)}` },
      recoveryRequired: false, catalog: clone(catalog),
    },
    plans: new Map(),
    jobs: [{ id: `swj-${hex(8)}`, kind: 'apply', state: 'succeeded', createdAtMs: now - 3 * 86_400_000, updatedAtMs: now - 3 * 86_400_000 + 48_000, error: null }],
    intents: new Map(),
    sftp: {
      config: {
        enabled: false, bindAddress: '0.0.0.0', port: 2222, allowCidrs: [], denyCidrs: [],
        limits: { sessions: 8, sessionsPerIp: 2, handlesPerSession: 16, transfersPerPrincipal: 4, bytesPerSecond: 8_388_608, bytesPerSession: 1_073_741_824, maxFileBytes: 67_108_864, idleTimeoutSecs: 120 },
      },
      running: false, boundAddress: null, hostKeyFingerprint: null, activeSessions: 0, authentication: ['publickey'],
      username: '6f1c2a90-3b4d-4e5f-8a7b-9c0d1e2f3a4b',
    },
    keys: [],
  };
}

export function createHostingFixtures(host: HostingHost) {
  const states = new Map<ConnectionId, HostingState>();
  const state = (id: ConnectionId) => { host.server(id); let value = states.get(id); if (!value) { value = seed(); states.set(id, value); } return value; };
  const owner = (id: ConnectionId) => { if (host.server(id).snapshot.connection.role !== 'owner') fail('forbidden', 'software_forbidden'); };
  const stopped = (id: ConnectionId, reason: string) => { if (host.server(id).snapshot.status?.state !== 'stopped') fail('conflict', reason); };
  /** Same intent and payload replays the first result; a changed payload conflicts. */
  const once = <T,>(current: HostingState, intentId: string, payload: unknown, run: () => T): T => {
    const key = JSON.stringify(payload);
    const known = current.intents.get(intentId);
    if (known) { if (known.payload !== key) fail('conflict', 'software_idempotency_conflict'); return clone(known.result as T); }
    const result = run();
    current.intents.set(intentId, { payload: key, result: clone(result) });
    return clone(result);
  };
  const runJob = (current: HostingState, job: SoftwareJob, onActivate: () => void, failWith?: string) => {
    const step = (state: SoftwareJob['state'], at: number, effect?: () => void) => setTimeout(() => {
      job.state = state; job.updatedAtMs = Date.now(); effect?.();
    }, at);
    step('staging', 600);
    if (failWith) { step('failed', 3_200, () => { job.error = failWith; }); return; }
    step('activating', 3_600);
    step('succeeded', 4_800, () => { onActivate(); current.software.revision = String(Number(current.software.revision) + 1); });
  };

  return {
    async javaInventory(connectionId: ConnectionId): Promise<ServerJavaInventory> { await host.wait(); owner(connectionId); return clone(state(connectionId).java); },
    async javaSelect(connectionId: ConnectionId, runtimeId: string | null, customPath: string | null, intentId: string): Promise<SoftwareJob> {
      owner(connectionId); const current = state(connectionId);
      return once(current, intentId, { runtimeId, customPath }, () => {
        stopped(connectionId, 'software_state_unavailable');
        if (!!runtimeId === !!customPath) fail('invalid_input');
        let runtime: ServerJavaRuntime | undefined;
        if (runtimeId) runtime = current.java.runtimes.find(r => r.id === runtimeId);
        else if (customPath?.startsWith('C:/Java/approved/') && !customPath.includes('..') && customPath.endsWith('/bin/java.exe')) runtime = { id: customPath, path: customPath, major: 21, version: '21.0.3', vendor: 'Oracle', arch: 'amd64', managed: false };
        else fail('forbidden');
        if (!runtime) fail('invalid_input');
        const chosen = runtime!;
        const job: SoftwareJob = { id: `java-select-${hex(8)}`, kind: 'java_select', state: 'queued', createdAtMs: Date.now(), updatedAtMs: Date.now(), error: null };
        current.jobs.unshift(job); runJob(current, job, () => { current.java.selected = clone(chosen); }); return job;
      });
    },
    async javaDownload(connectionId: ConnectionId, major: number, intentId: string): Promise<SoftwareJob> {
      owner(connectionId); const current = state(connectionId);
      return once(current, intentId, { major }, () => {
        if (!Number.isInteger(major) || major < 8 || major > 99) fail('invalid_input');
        const job: SoftwareJob = { id: `java-download-${hex(8)}`, kind: 'java_download', state: 'queued', createdAtMs: Date.now(), updatedAtMs: Date.now(), error: null };
        current.jobs.unshift(job); runJob(current, job, () => {
          if (!current.java.managedMajors.includes(major)) { current.java.managedMajors.push(major); current.java.runtimes.push({ id: `managed-${major}`, path: `private/managed-java/temurin-${major}/bin/java.exe`, major, version: `${major}.0.3`, vendor: 'Eclipse Adoptium', arch: 'amd64', managed: true }); }
        }); return job;
      });
    },
    async world(connectionId: ConnectionId): Promise<ServerWorld> {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'config.view');
      return clone(state(connectionId).world);
    },
    async worldDatapackOffline(connectionId: ConnectionId, packId: string, enabled: boolean, expectedRevision: string, intentId: string) {
      const target = host.server(connectionId); host.requireCapability(target, 'config.edit');
      const current = state(connectionId);
      return once(current, intentId, { packId, enabled, expectedRevision }, () => {
        if (target.snapshot.status?.state !== 'stopped') fail('conflict');
        if (current.world.revision !== expectedRevision) fail('conflict');
        const pack = current.world.datapacks.find(p => p.id === packId && (p.kind === 'folder' || p.kind === 'zip')) ?? fail('invalid_input');
        pack.enabled = enabled;
        current.world.revision = hex(64);
        return clone(current.world);
      });
    },
    async worldDatapackToggle(connectionId: ConnectionId, packId: string, enabled: boolean, expectedGeneration: string, intentId: string) {
      const target = host.server(connectionId); host.requireCapability(target, 'config.edit'); host.requireCapability(target, 'console.write');
      const current = state(connectionId);
      return once(current, intentId, { packId, enabled, expectedGeneration }, () => {
        if (target.snapshot.status?.state !== 'running' || target.snapshot.status.generation !== expectedGeneration) fail('conflict', 'datapack_requires_running_game');
        const pack = current.world.datapacks.find(p => p.id === packId && p.kind !== 'missing') ?? fail('invalid_input');
        const operation = host.datapackOperation(connectionId, `datapack ${enabled ? 'enable' : 'disable'} ${JSON.stringify(packId)}`);
        setTimeout(() => { pack.enabled = enabled; current.world.lastPlayedAtMs = Date.now(); }, 600); return operation;
      });
    },

    async software(connectionId: ConnectionId): Promise<SoftwareState> {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'content.install');
      owner(connectionId);
      return clone(state(connectionId).software);
    },
    async softwareVersions(connectionId: ConnectionId, software: SoftwareId): Promise<SoftwareVersions> {
      await host.wait(700);
      owner(connectionId);
      if (!AUTOMATIC.has(software)) fail('unsupported', 'provider_not_implemented');
      return { software, versions: [...VERSIONS[software]] };
    },
    async softwareReleases(connectionId: ConnectionId, software: SoftwareId, version: string) {
      await host.wait(200); owner(connectionId);
      if (!AUTOMATIC.has(software)) fail('unsupported', 'provider_not_implemented');
      if (!VERSIONS[software]?.includes(version)) fail('invalid_input');
      const releases = software === 'vanilla' ? [] : software === 'fabric' || software === 'quilt'
        ? ['0.16.9', '0.16.8', '0.16.7'].map(id => ({ id, build: null, loaderVersion: id }))
        : [150, 149, 148, 130].map(build => ({ id: String(build), build, loaderVersion: null }));
      return { software, version, releases };
    },
    async softwarePlan(connectionId: ConnectionId, request: SoftwarePlanRequest): Promise<SoftwarePlan> {
      await host.wait(900);
      owner(connectionId);
      const current = state(connectionId);
      if (!VERSIONS[request.software]?.includes(request.version)) fail('invalid_input', 'server_install.unavailable');
      const warnings: string[] = ['first_run_effects'];
      if (request.software === 'folia') warnings.push('region_threading');
      if (request.version.startsWith('1.18')) warnings.push('legacy_checksum');
      const plan: SoftwarePlan = {
        planId: `plan-${hex(10)}`, expiresAtMs: Date.now() + 120_000, expectedRevision: current.software.revision,
        software: request.software, version: request.version, loaderVersion: request.loaderVersion ?? (request.software === 'fabric' || request.software === 'quilt' ? '0.16.9' : null), build: ['paper', 'folia', 'purpur'].includes(request.software) ? request.build ?? 150 : null,
        java: { major: javaFor(request.version), evidence: `Minecraft ${request.version} requires Java ${javaFor(request.version)}` },
        javaCompatible: (current.java.selected?.major ?? 0) >= javaFor(request.version),
        selectedJavaMajor: current.java.selected?.major ?? null,
        managedDownloadMajor: (current.java.selected?.major ?? 0) < javaFor(request.version) ? javaFor(request.version) : null,
        warnings,
        risks: current.software.current?.software !== request.software ? ['cross_family_switch', 'world_upgrade'] : ['world_upgrade'],
      };
      if (plan.javaCompatible) current.plans.set(plan.planId, { plan, request, used: false });
      return clone(plan);
    },
    async softwareApply(connectionId: ConnectionId, planId: string, acknowledgeWarnings: boolean, acknowledgeLegacyChecksum: boolean, intentId: string): Promise<SoftwareJob> {
      await host.wait(400);
      owner(connectionId);
      const current = state(connectionId);
      return once(current, intentId, { planId, acknowledgeWarnings, acknowledgeLegacyChecksum }, () => {
        const entry = current.plans.get(planId) ?? fail('confirmation_expired', 'software_plan_expired');
        if (entry.used || entry.plan.expiresAtMs < Date.now()) fail('confirmation_expired', 'software_plan_expired');
        if (entry.plan.warnings.length && !acknowledgeWarnings) fail('invalid_input', 'software_invalid_request');
        if (entry.plan.warnings.includes('legacy_checksum') && !acknowledgeLegacyChecksum) fail('invalid_input', 'software_invalid_request');
        if (current.software.recoveryRequired) fail('conflict', 'software_recovery_required');
        if (current.jobs.some((job) => ['queued', 'staging', 'activating'].includes(job.state))) fail('server_busy', 'software_busy');
        stopped(connectionId, 'software_state_unavailable');
        if (entry.plan.expectedRevision !== current.software.revision) fail('stale_target', 'software_revision_conflict');
        entry.used = true;
        const job: SoftwareJob = { id: `swj-${hex(8)}`, kind: 'apply', state: 'queued', createdAtMs: Date.now(), updatedAtMs: Date.now(), error: null };
        current.jobs.unshift(job);
        // Quilt previews a staging failure so the error path can be seen.
        runJob(current, job, () => {
          current.software.previous = current.software.current;
          current.software.current = { software: entry.request.software, version: entry.request.version, build: entry.plan.build, loaderVersion: entry.plan.loaderVersion, installationId: `inst-${hex(8)}`, javaMajor: entry.plan.java.major };
        }, entry.request.software === 'quilt' ? 'server_install.storage_low' : undefined);
        return job;
      });
    },
    async softwareJobs(connectionId: ConnectionId): Promise<SoftwareJob[]> {
      await host.wait(120);
      owner(connectionId);
      return clone(state(connectionId).jobs.slice(0, 100));
    },
    async softwareRollback(connectionId: ConnectionId, expectedRevision: string, intentId: string): Promise<SoftwareJob> {
      await host.wait(400);
      owner(connectionId);
      const current = state(connectionId);
      return once(current, intentId, { expectedRevision }, () => {
        if (!current.software.previous) fail('not_found', 'software_previous_unavailable');
        stopped(connectionId, 'software_state_unavailable');
        if (expectedRevision !== current.software.revision) fail('stale_target', 'software_revision_conflict');
        const job: SoftwareJob = { id: `swj-${hex(8)}`, kind: 'rollback', state: 'queued', createdAtMs: Date.now(), updatedAtMs: Date.now(), error: null };
        current.jobs.unshift(job);
        runJob(current, job, () => {
          const swap = current.software.current;
          current.software.current = current.software.previous;
          current.software.previous = swap;
          current.software.recoveryRequired = false;
        });
        return job;
      });
    },

    async sftp(connectionId: ConnectionId): Promise<SftpStatus> {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'config.view');
      return clone(state(connectionId).sftp);
    },
    async sftpUpdate(connectionId: ConnectionId, patch: SftpConfigPatch, intentId: string): Promise<SftpStatus> {
      await host.wait(500);
      owner(connectionId);
      const current = state(connectionId);
      return once(current, intentId, patch, () => {
        const { limits, ...rest } = patch;
        const config = { ...current.sftp.config, ...rest, limits: { ...current.sftp.config.limits, ...limits } };
        if (config.enabled && config.port === 25565) fail('conflict', 'sftp_bind_failed');
        current.sftp = {
          ...current.sftp, config, running: config.enabled, activeSessions: 0,
          boundAddress: config.enabled ? `${config.bindAddress.includes(':') ? `[${config.bindAddress}]` : config.bindAddress}:${config.port}` : null,
          hostKeyFingerprint: current.sftp.hostKeyFingerprint ?? (config.enabled ? `SHA256:${base64(43)}` : null),
        };
        return current.sftp;
      });
    },
    async sftpKeys(connectionId: ConnectionId): Promise<SftpKey[]> {
      await host.wait();
      owner(connectionId);
      return clone(state(connectionId).keys);
    },
    async sftpKeyAdd(connectionId: ConnectionId, principalId: string, label: string, publicKey: string, expiresAtMs: number | null, intentId: string): Promise<SftpKey> {
      await host.wait(400);
      owner(connectionId);
      const current = state(connectionId);
      return once(current, intentId, { principalId, label, publicKey, expiresAtMs }, () => {
        if (publicKeyProblem(publicKey)) fail('invalid_input', 'sftp_key_invalid');
        const material = publicKey.trim().split(/\s+/).slice(0, 2).join(' ');
        if (current.keys.some((key) => !key.revokedAtMs && key.publicKey === material)) fail('conflict', 'sftp_key_duplicate');
        const key: SftpKey = {
          id: crypto.randomUUID(), principalId, label: label.trim() || publicKeyComment(publicKey) || 'SSH key', fingerprint: `SHA256:${base64(43)}`,
          publicKey: material, createdAtMs: Date.now(), expiresAtMs, revokedAtMs: null,
        };
        current.keys.unshift(key);
        return key;
      });
    },
    async sftpOpen(connectionId: ConnectionId, path = ''): Promise<SftpTarget> {
      const relative = path.replace(/\\/g, '/');
      if (relative.startsWith('/') || /^[a-z]:/i.test(relative) || /[\u0000-\u001f\u007f-\u009f]/.test(relative) || relative.split('/').includes('..')) fail('invalid_input');
      await host.wait(150);
      const current = state(connectionId);
      if (!current.sftp.running) fail('unsupported', 'sftp_disabled');
      // Browser previews have no OS handler; native opens the default client.
      return { host: hostOf(host.server(connectionId).snapshot.connection.endpoint), port: current.sftp.config.port, username: current.sftp.username, hostKeyFingerprint: current.sftp.hostKeyFingerprint };
    },
    async sftpKeyRevoke(connectionId: ConnectionId, keyId: string, _intentId: string): Promise<void> {
      await host.wait(300);
      owner(connectionId);
      const key = state(connectionId).keys.find((entry) => entry.id === keyId) ?? fail('not_found');
      key.revokedAtMs ??= Date.now();
    },
  };
}
