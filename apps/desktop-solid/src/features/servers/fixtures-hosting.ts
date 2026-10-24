// Fixture world, software and SFTP management for browser previews and checks. It keeps
// the agent rules the UI depends on: owner-only writes, a stopped game for world and
// software changes, exact world-name and revision checks, plans that expire, jobs that
// advance through staging and activation, and public-key-only SSH registrations.
import type { ConnectionId, ServerCommandError } from './native';
import type {
  ServerWorld, SftpConfigPatch, SftpKey, SftpStatus, SftpTarget, SoftwareDescriptor, SoftwareId, SoftwareJob, SoftwarePlan,
  SoftwarePlanRequest, SoftwareState, SoftwareVersions, WorldNewResult,
} from './hosting-native';
import { SOFTWARE_IDS } from './hosting-native';
import { hostOf, publicKeyComment, publicKeyProblem } from './hosting-model';

interface HostingHost {
  server(id: ConnectionId): { snapshot: { status: { state: string } | null; connection: { role: string | null; endpoint: string } } };
  requireCapability(target: ReturnType<HostingHost['server']>, capability: string): void;
  wait(ms?: number): Promise<unknown>;
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
    world: { name: 'world', seed: '-4172144997902289642', configuredSeed: '', exists: true, revision: '3' },
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
    async world(connectionId: ConnectionId): Promise<ServerWorld> {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'config.view');
      return clone(state(connectionId).world);
    },
    async worldNew(connectionId: ConnectionId, seedText: string, expectedRevision: string, confirmWorld: string, intentId: string): Promise<WorldNewResult> {
      await host.wait(500);
      const target = host.server(connectionId);
      host.requireCapability(target, 'config.edit');
      owner(connectionId);
      const current = state(connectionId);
      return once(current, intentId, { seedText, expectedRevision, confirmWorld }, () => {
        stopped(connectionId, 'world_not_stopped');
        if (expectedRevision !== current.world.revision) fail('stale_target');
        if (confirmWorld !== current.world.name) fail('invalid_input');
        const base = 'world';
        let index = current.worlds.length + 1;
        while (current.worlds.includes(`${base}-${index}`)) index += 1;
        const preserved = [...current.worlds];
        const name = `${base}-${index}`;
        current.worlds.push(name);
        current.world = { name, seed: null, configuredSeed: seedText.trim(), exists: false, revision: String(Number(current.world.revision) + 1) };
        return { world: current.world, preservedWorlds: preserved, outcome: 'succeeded' as const };
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
        software: request.software, version: request.version, build: request.software === 'paper' || request.software === 'purpur' ? 140 + Math.floor(Math.random() * 20) : null,
        java: { major: javaFor(request.version), evidence: `Minecraft ${request.version} requires Java ${javaFor(request.version)}` },
        warnings,
        risks: current.software.current?.software !== request.software ? ['cross_family_switch', 'world_upgrade'] : ['world_upgrade'],
      };
      current.plans.set(plan.planId, { plan, request, used: false });
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
          current.software.current = { software: entry.request.software, version: entry.request.version, build: entry.plan.build, installationId: `inst-${hex(8)}`, javaMajor: entry.plan.java.major };
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
    async sftpOpen(connectionId: ConnectionId): Promise<SftpTarget> {
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
