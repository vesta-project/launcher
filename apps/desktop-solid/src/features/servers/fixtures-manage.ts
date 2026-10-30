// Fixture backups, access and pack management for browser previews and checks. It keeps
// the agent's rules that matter to the UI: capability checks, rank-limited role changes,
// optimistic versions, two-step in-place restore that needs a stopped server, one-time
// invitation codes, and monotonic pack revisions.
import type { ConnectionId, ServerCommandError, ServerOperation } from './native';
import type {
  AccessSources, BackupJob, BackupOverview, BackupSnapshot, BackupStorage, Invitation, IssuedInvitation,
  PackOutcome, RoleSummary, ServerDevice, ServerUser,
} from './native-manage';
import { capabilitiesForRole } from './capabilities';
import type { BackupConfiguration, BackupConfigDraft, BackupConfigOutcome, BackupProfileConfig } from './native-backups-config';

export interface ManageHost {
  /** Throws `not_found` for unknown connections. */
  server(id: ConnectionId): {
    snapshot: { backupsConfigured?: boolean | null; status: { state: string } | null; pack: { hostedRevision: string | null; minimumRevision: string | null; status: 'published' | 'unpublished' } | null; connection: { role: string | null } };
  };
  requireOnline(target: ReturnType<ManageHost['server']>): void;
  requireCapability(target: ReturnType<ManageHost['server']>, capability: string): void;
  record(target: ReturnType<ManageHost['server']>, intent: string, summary?: ServerOperation['summary']): ServerOperation;
  publish(target: ReturnType<ManageHost['server']>): void;
  wait(ms?: number): Promise<unknown>;
}

const fail = (code: ServerCommandError['code']): never => { throw { code, retryAfterMs: null } satisfies ServerCommandError; };
const hex = (length: number) => Array.from({ length }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const clone = <T,>(value: T): T => structuredClone(value);
const version = () => `v${hex(8)}`;

const builtinRoles: RoleSummary[] = [
  ['owner', 'Owner', 100], ['administrator', 'Administrator', 90], ['maintainer', 'Maintainer', 60],
  ['moderator', 'Moderator', 40], ['viewer', 'Viewer', 20], ['pack-user', 'Pack user', 10], ['player', 'Player', 5], ['public', 'Public', 1],
].map(([id, name, rank]) => ({
  id: id as string, name: name as string, rank: rank as number, builtin: true,
  capabilities: (capabilitiesForRole(id as string) ?? ['public.info']).map((capability) => ({ capability, scope: '*' })),
}));
const roleById = (roles: RoleSummary[], id: string) => roles.find((role) => role.id === id) ?? fail('not_found');

interface ManageState {
  profiles: BackupProfileConfig[];
  backupRevision: number | null;
  repositoryInitialized: boolean;
  backupLimits: BackupStorage['limits'];
  configReceipts: Map<string, { payload: string; result: BackupConfigOutcome }>;
  jobs: BackupJob[];
  snapshots: Record<string, BackupSnapshot[]>;
  recoveryRequired: boolean;
  pendingRestore: Map<string, { expiresAtMs: number }>;
  roles: RoleSummary[];
  users: ServerUser[];
  devices: ServerDevice[];
  invitations: Invitation[];
  access: AccessSources;
}

function seed(): ManageState {
  const now = Date.now();
  const day = 86_400_000;
  const roles = clone(builtinRoles);
  const user = (id: string, name: string, roleId: string, devices: number): ServerUser => ({
    id, displayName: name, minecraftAccounts: [{ uuid: crypto.randomUUID(), name }],
    roles: [{ role: roleById(roles, roleId), expiresAtMs: null }], rank: roleById(roles, roleId).rank, deviceCount: devices, version: version(),
  });
  return {
    backupRevision: null,
    repositoryInitialized: true,
    backupLimits: { maxSnapshots: 60, maxRepositoryBytes: 20_000_000_000, minFreeBytes: 5_000_000_000 },
    configReceipts: new Map(),
    profiles: [
      { name: 'daily', mode: 'online', keepTotal: 30, keepHourly: 0, keepLast: 7, keepDaily: 7, keepWeekly: 4, keepMonthly: 3, onMutation: 'fail-world', warnSeconds: 60, maxSnapshots: 30, include: [], exclude: [] },
      { name: 'before-updates', mode: 'stopped', keepTotal: 5, keepHourly: 0, keepLast: 5, keepDaily: 0, keepWeekly: 0, keepMonthly: 0, onMutation: 'fail-any', warnSeconds: 0, maxSnapshots: 5, include: [], exclude: ['logs/'] },
    ],
    jobs: [
      { id: `job-${hex(6)}`, profile: 'daily', kind: 'backup', state: 'succeeded', requestedBy: 'Nightly backup', snapshotId: hex(32), errorCode: null,
        createdAtMs: now - day / 3, startedAtMs: now - day / 3, finishedAtMs: now - day / 3 + 94_000,
        result: { filesNew: 128, filesChanged: 412, filesUnmodified: 9_812, dataAdded: 184_320_000, consistency: 'world_save_consistent', worldChanged: true } },
      { id: `job-${hex(6)}`, profile: 'daily', kind: 'verify', state: 'succeeded', requestedBy: 'PlayerOne', snapshotId: null, errorCode: null,
        createdAtMs: now - day, startedAtMs: now - day, finishedAtMs: now - day + 40_000, result: { verified: true } },
      { id: `job-${hex(6)}`, profile: 'before-updates', kind: 'backup', state: 'failed', requestedBy: 'RedstoneRae', snapshotId: null, errorCode: 'backup_requires_stopped_server',
        createdAtMs: now - 2 * day, startedAtMs: now - 2 * day, finishedAtMs: now - 2 * day + 2_000, result: null },
    ],
    snapshots: {
      daily: Array.from({ length: 7 }, (_, index) => ({ id: hex(32), time: new Date(now - index * day - day / 3).toISOString(), safety: false })),
      'before-updates': [{ id: hex(32), time: new Date(now - 6 * day).toISOString(), safety: false }],
    },
    recoveryRequired: false,
    pendingRestore: new Map(),
    roles,
    users: [user('p-self', 'PlayerOne', 'owner', 2), user('p-rae', 'RedstoneRae', 'maintainer', 1), user('p-kai', 'Kai_builds', 'moderator', 1), user('p-alex', 'Alex', 'player', 1), user('p-mia', 'MiaCrafts', 'pack-user', 1), user('p-oak', 'OakLeaf', 'pack-user', 2), user('p-zed', 'zed_mines', 'pack-user', 1)],
    devices: [
      { id: 'd-self', name: 'This computer', revoked: false, current: true, userId: 'p-self', userName: 'PlayerOne', lastSeenAtMs: now },
      { id: 'd-laptop', name: 'Travel laptop', revoked: false, current: false, userId: 'p-self', userName: 'PlayerOne', lastSeenAtMs: now - 5 * day },
      { id: 'd-rae', name: "Rae's laptop", revoked: false, current: false, userId: 'p-rae', userName: 'RedstoneRae', lastSeenAtMs: now - 900_000 },
      { id: 'd-kai', name: 'Kai PC', revoked: false, current: false, userId: 'p-kai', userName: 'Kai_builds', lastSeenAtMs: now - 3 * day },
      { id: 'd-kai-old', name: 'Old laptop', revoked: true, current: false, userId: 'p-kai', userName: 'Kai_builds', lastSeenAtMs: now - 40 * day },
      { id: 'd-alex', name: 'Alex desktop', revoked: false, current: false, userId: 'p-alex', userName: 'Alex', lastSeenAtMs: now - 2 * day },
      { id: 'd-mia', name: 'Mia gaming PC', revoked: false, current: false, userId: 'p-mia', userName: 'MiaCrafts', lastSeenAtMs: now - 6 * 3_600_000 },
      { id: 'd-oak-1', name: 'OakLeaf desktop', revoked: false, current: false, userId: 'p-oak', userName: 'OakLeaf', lastSeenAtMs: now - day },
      { id: 'd-oak-2', name: 'OakLeaf laptop', revoked: false, current: false, userId: 'p-oak', userName: 'OakLeaf', lastSeenAtMs: now - 9 * day },
      { id: 'd-zed', name: 'zed steam deck', revoked: false, current: false, userId: 'p-zed', userName: 'zed_mines', lastSeenAtMs: now - 4 * day },
    ],
    invitations: [{ id: `inv-${hex(6)}`, role: roleById(roles, 'moderator'), createdAtMs: now - 600_000, expiresAtMs: now + 2_400_000, createdBy: 'PlayerOne' }],
    access: { anonymous: 'public', newUser: 'public', whitelist: 'player', whitelistEnabled: true, password: 'player', version: version() },
  };
}

export function createManageFixtures(host: ManageHost) {
  const states = new Map<ConnectionId, ManageState>();
  const state = (id: ConnectionId) => {
    const target = host.server(id);
    let value = states.get(id);
    if (!value) {
      value = seed();
      if (!target.snapshot.backupsConfigured) {
        value.profiles = []; value.jobs = []; value.snapshots = {}; value.repositoryInitialized = false;
        value.backupLimits = { maxSnapshots: null, maxRepositoryBytes: null, minFreeBytes: 1_073_741_824 };
      }
      states.set(id, value);
    }
    return value;
  };
  const callerRank = (id: ConnectionId) => {
    const role = host.server(id).snapshot.connection.role ?? 'public';
    return builtinRoles.find((entry) => entry.id === role)?.rank ?? 1;
  };
  const job = (id: ConnectionId, profile: string, kind: BackupJob['kind'], requestedBy = 'PlayerOne'): BackupJob => {
    const created: BackupJob = { id: `job-${hex(6)}`, profile, kind, state: 'queued', requestedBy, snapshotId: null, errorCode: null, createdAtMs: Date.now(), startedAtMs: null, finishedAtMs: null, result: null };
    state(id).jobs.unshift(created);
    return created;
  };
  const progress = (created: BackupJob, onDone?: () => void) => {
    setTimeout(() => { created.state = 'running'; created.startedAtMs = Date.now(); }, 400);
    setTimeout(() => { created.state = 'succeeded'; created.finishedAtMs = Date.now(); onDone?.(); }, 2400);
  };
  const knownProfile = (id: ConnectionId, profile: string) => { if (!state(id).profiles.some((entry) => entry.name === profile)) fail('not_found'); };

  return {
    async backupConfiguration(connectionId: ConnectionId): Promise<BackupConfiguration> {
      await host.wait();
      const target = host.server(connectionId);
      host.requireOnline(target); host.requireCapability(target, 'backups.configure');
      const current = state(connectionId);
      return clone({ source: current.backupRevision === null ? 'host_config' : 'stored', revision: current.backupRevision,
        profiles: current.profiles, limits: current.backupLimits, backupsConfigured: current.profiles.length > 0,
        repository: { kind: 'local', location: 'C:\\Vesta\\instances\\riverside\\backups\\repository', initialized: current.repositoryInitialized }, scheduleOwner: 'automation' });
    },
    async backupConfigure(connectionId: ConnectionId, draft: BackupConfigDraft, expectedRevision: number | null, intentId: string): Promise<BackupConfigOutcome> {
      await host.wait();
      const target = host.server(connectionId);
      host.requireOnline(target); host.requireCapability(target, 'backups.configure');
      const current = state(connectionId);
      const payload = JSON.stringify({ draft, expectedRevision });
      const receipt = current.configReceipts.get(intentId);
      if (receipt) { if (receipt.payload !== payload) fail('conflict'); return clone(receipt.result); }
      if (!intentId || draft.profiles.length > 16 || new Set(draft.profiles.map((p) => p.name)).size !== draft.profiles.length) fail('invalid_input');
      const bounded = (n: number, max: number) => Number.isSafeInteger(n) && n >= 0 && n <= max;
      const relative = (p: string) => p.length > 0 && p.length <= 512 && !p.startsWith('/') && !/[\\:*?\[\]{}\x00-\x1f]/.test(p) && p.split('/').every((s) => s && s !== '.' && s !== '..');
      for (const p of draft.profiles) {
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(p.name) || !['online', 'stopped'].includes(p.mode)
          || !['warn', 'fail-world', 'fail-any'].includes(p.onMutation)
          || ![p.keepTotal ?? 0, p.keepHourly ?? 0, p.keepLast, p.keepDaily, p.keepWeekly, p.keepMonthly].every((v) => bounded(v, 1000))
          || !bounded(p.warnSeconds, 600) || (p.maxSnapshots !== null && (!bounded(p.maxSnapshots, 4294967295) || p.maxSnapshots === 0))
          || p.include.length > 64 || !p.include.every(relative) || p.exclude.length > 64
          || p.exclude.some((s) => !s || s.length > 512 || /[\x00-\x1f]/.test(s) || /^[!#\\]/.test(s) || s.split('/').includes('..'))) fail('invalid_input');
      }
      if (![draft.limits.maxSnapshots, draft.limits.maxRepositoryBytes].every((v) => v === null || (bounded(v, Number.MAX_SAFE_INTEGER) && v > 0)) || !bounded(draft.limits.minFreeBytes, Number.MAX_SAFE_INTEGER)) fail('invalid_input');
      if (current.backupRevision !== expectedRevision) fail('stale_target');
      current.profiles = clone(draft.profiles); current.backupLimits = clone(draft.limits);
      if (draft.initializeRepository) current.repositoryInitialized = true;
      current.backupRevision = (current.backupRevision ?? 0) + 1;
      target.snapshot.backupsConfigured = current.profiles.length > 0;
      const result = { revision: current.backupRevision };
      current.configReceipts.set(intentId, { payload, result });
      host.publish(target);
      return clone(result);
    },
    async backups(connectionId: ConnectionId, before: string | null): Promise<BackupOverview> {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'backups.view');
      const current = state(connectionId);
      const start = before ? Number(before) : 0;
      return clone({ profiles: current.profiles, jobs: current.jobs.slice(start, start + 50), nextBefore: start + 50 < current.jobs.length ? String(start + 50) : null, recoveryRequired: current.recoveryRequired });
    },
    async backupSnapshots(connectionId: ConnectionId, profile: string): Promise<BackupSnapshot[]> {
      await host.wait(300);
      host.requireCapability(host.server(connectionId), 'backups.view');
      knownProfile(connectionId, profile);
      return clone(state(connectionId).snapshots[profile] ?? []);
    },
    async backupStorage(connectionId: ConnectionId): Promise<BackupStorage> {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'backups.view');
      const current = state(connectionId);
      const restorePoints = Object.values(current.snapshots).flat().filter((entry) => !entry.safety).length;
      return { repositoryBytes: current.repositoryInitialized ? 3_410_000_000 : 0, restorePoints, safetySnapshots: Object.values(current.snapshots).flat().filter((entry) => entry.safety).length,
        freeBytes: 182_000_000_000, limits: clone(current.backupLimits), stopped: null };
    },
    async backupRun(connectionId: ConnectionId, profile: string, _intentId: string): Promise<BackupJob> {
      await host.wait();
      const target = host.server(connectionId);
      host.requireOnline(target);
      host.requireCapability(target, 'backups.create');
      knownProfile(connectionId, profile);
      const created = job(connectionId, profile, 'backup');
      if (state(connectionId).profiles.find((entry) => entry.name === profile)?.mode === 'stopped' && target.snapshot.status?.state !== 'stopped') {
        setTimeout(() => { created.state = 'failed'; created.errorCode = 'backup_requires_stopped_server'; created.finishedAtMs = Date.now(); }, 600);
        return clone(created);
      }
      progress(created, () => {
        created.snapshotId = hex(32);
        created.result = { filesNew: 12, filesChanged: 96, filesUnmodified: 10_204, dataAdded: 41_200_000, consistency: 'world_save_consistent', worldChanged: true };
        state(connectionId).snapshots[profile] = [{ id: created.snapshotId, time: new Date().toISOString(), safety: false }, ...(state(connectionId).snapshots[profile] ?? [])];
      });
      return clone(created);
    },
    async backupVerify(connectionId: ConnectionId, profile: string, _intentId: string): Promise<BackupJob> {
      await host.wait();
      const target = host.server(connectionId);
      host.requireOnline(target);
      host.requireCapability(target, 'backups.verify');
      knownProfile(connectionId, profile);
      const created = job(connectionId, profile, 'verify');
      progress(created, () => { created.result = { verified: true }; });
      return clone(created);
    },
    async backupRestoreCopy(connectionId: ConnectionId, profile: string, snapshot: string, _paths: string[], _intentId: string): Promise<BackupJob> {
      await host.wait();
      const target = host.server(connectionId);
      host.requireOnline(target);
      host.requireCapability(target, 'backups.restore');
      if (!(state(connectionId).snapshots[profile] ?? []).some((entry) => entry.id === snapshot)) fail('not_found');
      const created = job(connectionId, profile, 'restore');
      created.snapshotId = snapshot;
      progress(created);
      return clone(created);
    },
    async backupRestorePrepare(connectionId: ConnectionId, profile: string, snapshot: string, _paths: string[], skipSafetySnapshot: boolean, _intentId: string) {
      await host.wait();
      const target = host.server(connectionId);
      host.requireOnline(target);
      host.requireCapability(target, 'backups.restore');
      if (target.snapshot.status?.state !== 'stopped') fail('stale_target');
      if (!(state(connectionId).snapshots[profile] ?? []).some((entry) => entry.id === snapshot)) fail('not_found');
      const created = job(connectionId, profile, 'restore_in_place');
      created.state = 'awaiting_confirmation';
      created.snapshotId = snapshot;
      created.result = { safetySnapshotId: skipSafetySnapshot ? null : hex(32) };
      const expiresAtMs = Date.now() + 120_000;
      state(connectionId).pendingRestore.set(created.id, { expiresAtMs });
      return { job: clone(created), expiresAtMs };
    },
    async backupRestoreConfirm(connectionId: ConnectionId, jobId: string): Promise<BackupJob> {
      await host.wait();
      const target = host.server(connectionId);
      host.requireCapability(target, 'backups.restore');
      const current = state(connectionId);
      const pending = current.pendingRestore.get(jobId);
      const created = current.jobs.find((entry) => entry.id === jobId) ?? fail('not_found');
      if (!pending) fail('conflict');
      current.pendingRestore.delete(jobId);
      if (pending!.expiresAtMs < Date.now()) { created.state = 'failed'; created.errorCode = 'backup_confirmation_expired'; fail('confirmation_expired'); }
      if (target.snapshot.status?.state !== 'stopped') { created.state = 'failed'; created.errorCode = 'backup_requires_stopped_server'; fail('stale_target'); }
      created.state = 'queued';
      progress(created, () => { created.result = { ...created.result, filesWritten: 3_204, filesRemoved: 18 }; });
      return clone(created);
    },
    async backupResolveRecovery(connectionId: ConnectionId, jobId: string): Promise<BackupJob> {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'backups.restore');
      const current = state(connectionId);
      const found = current.jobs.find((entry) => entry.id === jobId) ?? fail('not_found');
      found.state = 'failed';
      current.recoveryRequired = false;
      return clone(found);
    },

    async users(connectionId: ConnectionId, offset: number) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'principals.view');
      const all = state(connectionId).users;
      return clone({ users: all.slice(offset, offset + 50), nextOffset: offset + 50 < all.length ? offset + 50 : null });
    },
    async roles(connectionId: ConnectionId) {
      await host.wait(60);
      host.requireCapability(host.server(connectionId), 'principals.view');
      return clone(state(connectionId).roles);
    },
    async userRoles(connectionId: ConnectionId, userId: string, add: string[], remove: string[], expectedVersion: string, _intentId: string): Promise<ServerUser> {
      await host.wait();
      const target = host.server(connectionId);
      host.requireCapability(target, 'principals.manage');
      const current = state(connectionId);
      const user = current.users.find((entry) => entry.id === userId) ?? fail('not_found');
      if (user.version !== expectedVersion) fail('stale_target');
      const rank = callerRank(connectionId);
      // Remote changes only reach users and roles strictly below the caller; Owner/Administrator are local-only grants.
      if (user.rank >= rank) fail('forbidden');
      for (const id of [...add, ...remove]) {
        const role = roleById(current.roles, id);
        if (role.rank >= rank || id === 'owner' || id === 'administrator') fail('forbidden');
      }
      user.roles = user.roles.filter((entry) => !remove.includes(entry.role.id));
      for (const id of add) if (!user.roles.some((entry) => entry.role.id === id)) user.roles.push({ role: roleById(current.roles, id), expiresAtMs: null });
      user.rank = Math.max(0, ...user.roles.map((entry) => entry.role.rank));
      user.version = version();
      host.record(target, 'access.roles');
      return clone(user);
    },
    async devices(connectionId: ConnectionId) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'devices.revoke');
      return clone(state(connectionId).devices);
    },
    async revokeDevice(connectionId: ConnectionId, deviceId: string, _intentId: string) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'devices.revoke');
      const device = state(connectionId).devices.find((entry) => entry.id === deviceId) ?? fail('not_found');
      if (device.current) fail('invalid_input');
      device.revoked = true;
    },
    async invitations(connectionId: ConnectionId) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'invitations.create');
      const now = Date.now();
      return clone(state(connectionId).invitations.filter((entry) => entry.expiresAtMs > now));
    },
    async createInvitation(connectionId: ConnectionId, roleId: string, expiresMinutes: number, _intentId: string): Promise<IssuedInvitation> {
      await host.wait(400);
      host.requireCapability(host.server(connectionId), 'invitations.create');
      if (!Number.isInteger(expiresMinutes) || expiresMinutes < 1 || expiresMinutes > 60) fail('invalid_input');
      const current = state(connectionId);
      const role = roleById(current.roles, roleId);
      if (role.rank >= callerRank(connectionId) || roleId === 'owner' || roleId === 'administrator') fail('forbidden');
      const id = `inv-${hex(6)}`;
      const expiresAtMs = Date.now() + expiresMinutes * 60_000;
      current.invitations.unshift({ id, role, createdAtMs: Date.now(), expiresAtMs, createdBy: 'PlayerOne' });
      const code = Array.from({ length: 43 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[Math.floor(Math.random() * 64)]).join('');
      return { id, code, pairingLink: `vesta://pair?endpoint=${encodeURIComponent('https://play.riverside.example:8443/')}&code=${code}&fp=${'a'.repeat(64)}&sid=srv_riverside`, role: roleId, expiresAtMs };
    },
    async revokeInvitation(connectionId: ConnectionId, invitationId: string, _intentId: string) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'invitations.create');
      const current = state(connectionId);
      if (!current.invitations.some((entry) => entry.id === invitationId)) fail('not_found');
      current.invitations = current.invitations.filter((entry) => entry.id !== invitationId);
    },
    async accessSources(connectionId: ConnectionId) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'access-sources.manage');
      return clone(state(connectionId).access);
    },
    async updateAccessSources(connectionId: ConnectionId, patch: Partial<Omit<AccessSources, 'version'>>, expectedVersion: string, _intentId: string) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'access-sources.manage');
      const current = state(connectionId);
      if (current.access.version !== expectedVersion) fail('stale_target');
      // Automatic sources may only hold public and pack capabilities.
      for (const key of ['anonymous', 'newUser', 'whitelist', 'password'] as const) {
        const value = patch[key];
        if (value !== undefined && !['public', 'player', 'pack-user'].includes(value)) fail('forbidden');
        if (value === 'pack-user') fail('forbidden');
      }
      current.access = { ...current.access, ...patch, version: version() };
      return clone(current.access);
    },

    async packPublish(connectionId: ConnectionId, expectedRevision: string, _intentId: string): Promise<PackOutcome> {
      await host.wait(800);
      const target = host.server(connectionId);
      host.requireCapability(target, 'pack.publish');
      const pack = target.snapshot.pack ?? fail('unsupported');
      if ((pack.hostedRevision ?? '0') !== expectedRevision) fail('stale_target');
      pack.hostedRevision = String(Number(expectedRevision) + 1);
      pack.minimumRevision ??= pack.hostedRevision;
      pack.status = 'published';
      host.publish(target);
      return { hostedRevision: pack.hostedRevision, minimumRevision: pack.minimumRevision };
    },
    async packMinimum(connectionId: ConnectionId, expectedRevision: string, minimumRevision: string, _intentId: string): Promise<PackOutcome> {
      await host.wait();
      const target = host.server(connectionId);
      host.requireCapability(target, 'pack.force_update');
      const pack = target.snapshot.pack ?? fail('unsupported');
      if (pack.hostedRevision !== expectedRevision) fail('stale_target');
      if (Number(minimumRevision) < Number(pack.minimumRevision ?? 0) || Number(minimumRevision) > Number(pack.hostedRevision)) fail('invalid_input');
      pack.minimumRevision = minimumRevision;
      host.publish(target);
      return { hostedRevision: pack.hostedRevision!, minimumRevision };
    },
  };
}
