// Fixture server manager for browser previews and checks. It follows the native
// contract's semantics (generations, 202-style operations, two-step kill and OP,
// unknown player counts, console gaps) so the UI can be exercised without an agent.
import { capabilitiesForRole } from './capabilities';
import { parseAddressInput, isPairingCode, normalizePairingCode } from './address';
import type {
  BanEntry, ConnectionId, ConsoleLine, Discovery, ModerationAction, ModerationResult, OperatorEntry, Page, PlayersView,
  ServerCommandError, ServerConnection, ServerEvent, ServerOperation, ServerSnapshot, ServerStatus, ServerTopic, WhitelistEntry,
} from './native';
import type { ServersApi, Unsubscribe } from './service';
import { createFileFixtures } from './fixtures-files';
import { createManageFixtures, type ManageHost } from './fixtures-manage';
import { createPresenceFixtures } from './fixtures-presence';
import { createBrandingFixtures } from './fixtures-branding';
import { createAutomationFixtures } from './fixtures-automation';

const fail = (code: ServerCommandError['code'], retryAfterMs?: number): never => {
  throw { code, retryAfterMs: retryAfterMs ?? null } satisfies ServerCommandError;
};

const hex = (length: number) => Array.from({ length }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const sample = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const PLAYERS = ['Alex', 'Steve', 'Notch_Fan', 'RedstoneRae', 'Kai_builds', 'mossy_m'];
const CHATTER = [
  '[Server thread/INFO]: {p} joined the game',
  '[Server thread/INFO]: <{p}> anyone got spare iron?',
  '[Server thread/INFO]: {p} has made the advancement [Stone Age]',
  '[Server thread/INFO]: Saving the game (this may take a moment!)',
  '[Server thread/INFO]: Saved the game',
  '[Server thread/WARN]: Can\'t keep up! Is the server overloaded? Running 2034ms or 40 ticks behind',
  '[Server thread/INFO]: <{p}> brb',
];
/** Minecraft's console time prefix, so fixture lines parse like real server output. */
const stamp = (text: string, atMs: number) => `[${new Date(atMs).toTimeString().slice(0, 8)}] ${text}`;

interface FixtureServer {
  snapshot: ServerSnapshot;
  online: string[];
  operations: ServerOperation[];
  console: ConsoleLine[];
  cursor: number;
  whitelist: WhitelistEntry[];
  ops: OperatorEntry[];
  bans: BanEntry[];
  /** Pending two-step confirmations keyed by intent. */
  pending: Map<string, { kind: 'kill' | 'op'; expiresAtMs: number; generation: string; request?: ModerationAction }>;
  /** Intent id → canonical payload and its operation, like the agent's idempotency receipts. */
  intents: Map<string, { payload: string; operation: ServerOperation }>;
  ticker?: ReturnType<typeof setInterval>;
}

function status(state: ServerStatus['state'], generation: string | null, players: number | null): ServerStatus {
  return {
    state,
    lifecycle: state === 'stopped' ? 'offline' : state === 'running' ? 'online' : 'stopping',
    generation,
    playerCount: players,
    playerCountKnown: players !== null,
    playerCountObservedAtMs: players !== null ? Date.now() - 35_000 : null,
    uptimeSeconds: state === 'running' ? '15840' : null,
    readiness: state === 'stopped' ? 'stopped' : 'ready',
    readinessReason: null,
    readinessEvidence: 'log_and_probe',
    supervision: 'separate',
    supervisor: { orphanRunning: false, launchUnresolved: false, observationFailed: false, crashRestartEnabled: true, crashLoop: false, restartStateUnsaved: false, recentCrashes: 0, restartPendingMs: null },
  };
}

function connection(id: string, name: string, endpoint: string, role: string | null, extra: Partial<ServerConnection> = {}): ServerConnection {
  return {
    id, name, endpoint, serverId: `srv_${id.replace(/^fixture-/, "")}`, fingerprint: hex(64), role, signInMethod: role ? 'pairing_code' : 'minecraft',
    memoryOnly: false, pinned: false, addedAtMs: Date.now() - 86_400_000 * 12, lastConnectedAtMs: Date.now() - 60_000, ...extra,
  };
}

function seed(): FixtureServer[] {
  const now = Date.now();
  const survival: FixtureServer = {
    snapshot: {
      connection: connection('fixture-survival', 'Riverside SMP', 'play.riverside.example:8443', 'owner', { pinned: true }),
      state: { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
      info: { serverId: 'srv_riverside', name: 'Riverside SMP', agentVersion: '0.9.0', minecraftVersion: '1.21.4', packVersion: '3.2' },
      status: status('running', hex(32), 3),
      statusObservedAtMs: now,
      pack: { hostedRevision: '14', minimumRevision: '12', status: 'published' },
      capabilities: { source: 'session', granted: capabilitiesForRole('owner') ?? [], refused: [] },
      restartRequired: true,
      joinAddress: 'play.riverside.example:25565', backupsConfigured: true,
    },
    online: ['Alex', 'RedstoneRae', 'Kai_builds'],
    operations: [
      { operationId: 'op-1', intent: 'lifecycle.restart', kind: 'lifecycle.restart', state: 'succeeded', progressPercent: 100, createdAtMs: now - 3_600_000, updatedAtMs: now - 3_540_000, finishedAtMs: now - 3_540_000, reconciling: false,
        actor: { kind: 'workflow', name: 'Nightly restart' }, summary: { kind: 'lifecycle', action: 'restart', targetGeneration: hex(32), resultGeneration: hex(32) }, outcome: null },
      { operationId: 'op-2', intent: 'console.command', kind: 'console.command', state: 'succeeded', progressPercent: 100, createdAtMs: now - 1_200_000, updatedAtMs: now - 1_199_000, finishedAtMs: now - 1_199_000, reconciling: false,
        actor: { kind: 'principal', principalId: 'p-rae', displayName: 'RedstoneRae', deviceName: "Rae's laptop", self: false }, summary: { kind: 'console.command', command: 'time set day' }, outcome: 'stdin_written' },
      { operationId: 'op-3', intent: 'players.moderate', kind: 'players.moderate', state: 'succeeded', progressPercent: 100, createdAtMs: now - 900_000, updatedAtMs: now - 899_000, finishedAtMs: now - 899_000, reconciling: false,
        actor: { kind: 'principal', principalId: 'p-rae', displayName: 'RedstoneRae', deviceName: "Rae's laptop", self: false }, summary: { kind: 'players.moderate', action: 'ban', player: 'griefer_99', reason: 'Griefing spawn', durationSeconds: 86_400 * 3 }, outcome: 'stdin_written' },
    ],
    console: [],
    cursor: 0,
    whitelist: PLAYERS.slice(0, 5).map((name) => ({ name, uuid: crypto.randomUUID() })),
    ops: [{ name: 'Alex', uuid: crypto.randomUUID(), level: 4, bypassesPlayerLimit: false }],
    bans: [{ name: 'griefer_99', uuid: crypto.randomUUID(), reason: 'Griefing spawn', created: '2026-10-02 18:12:44 +0000', expires: 'forever', source: 'Server' }],
    pending: new Map(), intents: new Map(),
  };
  for (let index = 0; index < 40; index++) {
    // One line arrives cut short, as the agent does past its per-line bound.
    const text = stamp(sample(CHATTER).replace('{p}', sample(PLAYERS)), now - (40 - index) * 15_000);
    survival.console.push({ cursor: String(++survival.cursor), text, truncated: index === 30 });
  }
  const creative: FixtureServer = {
    snapshot: {
      connection: connection('fixture-creative', 'Build team', '192.168.1.40:8443', 'viewer'),
      joinAddress: '192.168.1.40:25565', backupsConfigured: false,
      state: { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
      info: { serverId: 'srv_build', name: 'Build team', agentVersion: '0.9.0', minecraftVersion: '1.20.1', packVersion: '1.0' },
      status: status('stopped', null, null),
      statusObservedAtMs: now - 20_000,
      pack: { hostedRevision: null, minimumRevision: null, status: 'unpublished' },
      capabilities: { source: 'role_defaults', granted: capabilitiesForRole('viewer') ?? [], refused: [] },
      restartRequired: false,
    },
    online: [], operations: [], console: [], cursor: 0, whitelist: [], ops: [], bans: [], pending: new Map(), intents: new Map(),
  };
  const away: FixtureServer = {
    snapshot: {
      connection: connection('fixture-away', 'Friends modded', '[2001:db8::42]:8443', 'maintainer'),
      state: { phase: 'backoff', access: 'paired', retryAtMs: now + 40_000, rateLimitedUntilMs: null, lastError: 'unreachable' },
      info: { serverId: 'srv_friends', name: 'Friends modded', agentVersion: '0.8.2', minecraftVersion: '1.20.1', packVersion: '7' },
      status: status('running', hex(32), null),
      statusObservedAtMs: now - 4 * 60_000,
      pack: null,
      capabilities: { source: 'role_defaults', granted: capabilitiesForRole('maintainer') ?? [], refused: [] },
      restartRequired: false,
    },
    online: [], operations: [], console: [], cursor: 0, whitelist: [], ops: [], bans: [], pending: new Map(), intents: new Map(),
  };
  return [survival, creative, away];
}

export function createFixtureServers(options: { seeded?: boolean; latencyMs?: number } = {}): ServersApi {
  const servers = new Map<ConnectionId, FixtureServer>((options.seeded ?? true ? seed() : []).map((server) => [server.snapshot.connection.id, server]));
  const discoveries = new Map<string, Discovery & { address: string }>();
  const offlineReceipts = new Map<string, { payload: string; sha256: string }>();
  const whitelistHash = async (target: FixtureServer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(target.whitelist)))), (b) => b.toString(16).padStart(2, '0')).join('');
  const listeners = new Set<() => void>();
  const subscribers = new Map<ConnectionId, Map<ServerTopic, Set<(event: ServerEvent) => void>>>();
  const latency = options.latencyMs ?? 180;
  const wait = (ms = latency) => new Promise((resolve) => setTimeout(resolve, ms));
  const clone = <T,>(value: T): T => structuredClone(value);

  const server = (id: ConnectionId) => servers.get(id) ?? fail('not_found');
  const changed = () => { for (const listener of listeners) listener(); };
  const emit = (id: ConnectionId, topic: ServerTopic, event: ServerEvent) => {
    for (const listener of subscribers.get(id)?.get(topic) ?? []) listener(clone(event));
  };
    const rosterOf = (target: FixtureServer): PlayersView => {
      const current = target.snapshot.status;
      if (target.snapshot.state.phase !== 'online' || target.snapshot.state.access !== 'paired'
        || !target.snapshot.capabilities.granted.includes('players.view')
        || current?.state !== 'running' || !current.generation || current.readiness !== 'ready') return { known: false };
      return { known: true, generation: current.generation, playerCount: target.online.length, names: [...target.online] };
    };
    const publishedRosters = new WeakMap<FixtureServer, string>();
    const publish = (target: FixtureServer) => {
    target.snapshot.statusObservedAtMs = Date.now();
    emit(target.snapshot.connection.id, 'status', { kind: 'snapshot', snapshot: clone(target.snapshot) });
      const players = rosterOf(target);
      const key = JSON.stringify(players);
      if (publishedRosters.get(target) !== key) {
        publishedRosters.set(target, key);
        emit(target.snapshot.connection.id, 'status', { kind: 'players', players });
      }
    changed();
  };
  const requireOnline = (target: FixtureServer) => {
    if (target.snapshot.state.phase !== 'online') fail('unreachable');
  };
  const requireCapability = (target: FixtureServer, capability: string) => {
    const caps = target.snapshot.capabilities;
    if (!caps.granted.includes(capability)) {
      if (!caps.refused.includes(capability)) caps.refused.push(capability);
      publish(target);
      fail('forbidden');
    }
  };
  const record = (target: FixtureServer, intent: string, summary: ServerOperation['summary'] = null): ServerOperation => {
    const now = Date.now();
    const operation: ServerOperation = {
      operationId: `op-${hex(10)}`, intent, kind: intent, state: 'queued', progressPercent: 0, createdAtMs: now, updatedAtMs: now, finishedAtMs: null, reconciling: false,
      actor: { kind: 'principal', principalId: 'p-self', displayName: 'PlayerOne', deviceName: 'This computer', self: true }, summary, outcome: null,
    };
    target.operations.unshift(operation);
    emit(target.snapshot.connection.id, 'operations', { kind: 'operation', operation: clone(operation) });
    return operation;
  };
  /** Same intent and payload replays the original operation; a changed payload is a conflict. */
  const replay = (target: FixtureServer, intentId: string, payload: unknown) => {
    const known = target.intents.get(intentId);
    if (!known) return undefined;
    if (known.payload !== JSON.stringify(payload)) fail('conflict');
    return clone(known.operation);
  };
  const remember = (target: FixtureServer, intentId: string, payload: unknown, operation: ServerOperation) => {
    target.intents.set(intentId, { payload: JSON.stringify(payload), operation });
  };
  const advance = (target: FixtureServer, operation: ServerOperation, state: ServerOperation['state']) => {
    operation.state = state;
    operation.updatedAtMs = Date.now();
    if (state === 'running') operation.progressPercent = 50;
    if (['succeeded', 'failed', 'cancelled', 'recovery_required'].includes(state)) {
      operation.finishedAtMs = operation.updatedAtMs;
      if (state === 'succeeded') operation.outcome = operation.kind === 'console.command' || operation.kind === 'players.moderate' ? 'stdin_written' : operation.kind === 'lifecycle.stop' || operation.kind === 'lifecycle.kill' ? 'process_exited' : null;
      operation.progressPercent = 100;
    }
    emit(target.snapshot.connection.id, 'operations', { kind: 'operation', operation: clone(operation) });
  };
  const line = (target: FixtureServer, text: string) => {
    const entry = { cursor: String(++target.cursor), text: stamp(text, Date.now()), truncated: false };
    target.console.push(entry);
    if (target.console.length > 10_000) target.console.shift();
    emit(target.snapshot.connection.id, 'console', { kind: 'console', lines: [entry] });
  };
  const setState = (target: FixtureServer, state: ServerStatus['state'], players: number | null) => {
    const previous = target.snapshot.status;
    const generation = state === 'stopped' ? null : state === 'running' && previous?.state !== 'running' ? hex(32) : previous?.generation ?? hex(32);
    target.snapshot.status = { ...status(state, generation, players), playerCountObservedAtMs: players !== null ? Date.now() : null, uptimeSeconds: state === 'running' ? '0' : null };
    if (state === 'running') target.snapshot.status.readiness = 'starting';
    publish(target);
  };
  const ensureTicker = (target: FixtureServer) => {
    if (target.ticker) return;
    target.ticker = setInterval(() => {
      const current = target.snapshot.status;
      if (current?.state !== 'running') return;
      if (Math.random() < 0.6) line(target, sample(CHATTER).replace('{p}', sample(target.online.length ? target.online : PLAYERS)));
      emit(target.snapshot.connection.id, 'metrics', {
        kind: 'metrics',
        sample: {
          atMs: Date.now(), cpuPercent: Math.round(18 + Math.random() * 30), memoryUsedBytes: String(Math.round((2.6 + Math.random() * 0.6) * 1024 ** 3)),
          memoryMaxBytes: String(6 * 1024 ** 3), tps: Math.round((19.2 + Math.random() * 0.8) * 10) / 10, mspt: Math.round(18 + Math.random() * 20), playersOnline: target.online.length,
        },
      });
    }, 1200);
  };
  const stopTickerIfIdle = (target: FixtureServer) => {
    const topics = subscribers.get(target.snapshot.connection.id);
    const active = [...(topics?.values() ?? [])].some((set) => set.size > 0);
    if (!active && target.ticker) { clearInterval(target.ticker); target.ticker = undefined; }
  };

  const manage = createManageFixtures({ server, requireOnline, requireCapability, record, publish, wait } as unknown as ManageHost);
  /** The fixture caller is always `p-self`; ranks come from the access fixture's users. */
  const principals = async (id: ConnectionId) => {
    const { users } = await manage.users(id, 0);
    return { selfId: 'p-self', ranks: Object.fromEntries(users.map((user) => [user.id, user.rank])) };
  };

  const api: ServersApi = {
    async list() { await wait(60); return [...servers.values()].map((entry) => clone(entry.snapshot)); },

    async discover(address) {
      await wait(500);
      const parsed = parseAddressInput(address);
      if (parsed.kind === 'invalid') return fail('invalid_address');
      const target = parsed.kind === 'link' ? parsed.address : parsed;
      if (target.host.startsWith('offline') || target.host === '10.0.0.99') fail('unreachable');
      const fingerprint = target.host.startsWith('mitm') ? hex(64) : 'a3f19c0d7be24e86c5d9017f3a6b28e4c90d5f17e2b8a4c6d3e0f9b7a1c5e823';
      const existing = [...servers.values()].find((entry) => entry.snapshot.connection.endpoint === target.display);
      const discovery = {
        address,
        discoveryId: `discovery-${hex(8)}`,
        endpoint: target.display,
        serverId: parsed.kind === 'link' && parsed.serverId ? parsed.serverId : `srv_${hex(12)}`,
        fingerprint,
        publicLifecycle: 'online',
        expectedFingerprint: parsed.kind === 'link' ? parsed.fingerprint : null,
        linkCode: parsed.kind === 'link' ? parsed.code : null,
        existingConnectionId: existing?.snapshot.connection.id ?? null,
        // Hosts named novault… simulate a machine without a usable credential store.
        secureStorageAvailable: !target.host.startsWith('novault'),
      };
      discoveries.set(discovery.discoveryId, discovery);
      const { address: _, ...result } = discovery;
      return result;
    },

    async pair(discoveryId, code, options = {}) {
      await wait(700);
      const discovery = discoveries.get(discoveryId) ?? fail('not_found');
      // The storage check happens before the code is redeemed, so the code stays usable.
      if (!discovery.secureStorageAvailable && !options.memoryOnly) fail('credentials_unavailable');
      const normalized = normalizePairingCode(code);
      if (!isPairingCode(normalized)) fail('pair_code_invalid');
      if (normalized.startsWith('lost')) fail('pair_outcome_unknown');
      if (normalized.startsWith('bad')) fail('pair_code_invalid');
      const id = `fixture-${hex(6)}`;
      const name = discovery.endpoint.split(':')[0].replace(/^\[|\]$/g, '');
      const entry: FixtureServer = {
        snapshot: {
          connection: { ...connection(id, name, discovery.endpoint, 'owner'), serverId: discovery.serverId, fingerprint: discovery.fingerprint, lastConnectedAtMs: Date.now(), addedAtMs: Date.now(), memoryOnly: !!options.memoryOnly },
          state: { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
          info: { serverId: discovery.serverId, name, agentVersion: '0.9.0', minecraftVersion: '1.21.4', packVersion: '1.0' },
          status: status('stopped', null, null),
          statusObservedAtMs: Date.now(),
          pack: { hostedRevision: null, minimumRevision: null, status: 'unpublished' },
          capabilities: { source: 'session', granted: capabilitiesForRole('owner') ?? [], refused: [] },
          restartRequired: false,
        },
        online: [], operations: [], console: [], cursor: 0, whitelist: [], ops: [], bans: [], pending: new Map(), intents: new Map(),
      };
      servers.set(id, entry);
      discoveries.delete(discoveryId);
      changed();
      return clone(entry.snapshot);
    },

    async signInMinecraft(discoveryId, _accountUuid, options = {}) {
      await wait(900);
      const discovery = discoveries.get(discoveryId) ?? fail('not_found');
      if (!discovery.secureStorageAvailable && !options.memoryOnly) fail('credentials_unavailable');
      const id = `fixture-${hex(6)}`;
      const name = discovery.endpoint.split(':')[0];
      const entry: FixtureServer = {
        snapshot: {
          connection: { ...connection(id, name, discovery.endpoint, null), serverId: discovery.serverId, fingerprint: discovery.fingerprint, signInMethod: 'minecraft', memoryOnly: !!options.memoryOnly },
          state: { phase: 'online', access: 'no_management_access', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
          info: null, status: null, statusObservedAtMs: null, pack: null,
          capabilities: { source: 'session', granted: ['public.info', 'pack.download', 'pack.realtime'], refused: [] },
          restartRequired: false,
        },
        online: [], operations: [], console: [], cursor: 0, whitelist: [], ops: [], bans: [], pending: new Map(), intents: new Map(),
      };
      servers.set(id, entry);
      changed();
      return clone(entry.snapshot);
    },

    async approveFingerprint(connectionId, fingerprint) {
      await wait();
      const target = server(connectionId);
      target.snapshot.connection.fingerprint = fingerprint;
      target.snapshot.state.access = 'paired';
      publish(target);
      return clone(target.snapshot);
    },

    async update(connectionId, patch) {
      await wait(40);
      const target = server(connectionId);
      Object.assign(target.snapshot.connection, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
      publish(target);
      return clone(target.snapshot);
    },

    async remove(connectionId) {
      await wait(80);
      const target = server(connectionId);
      if (target.ticker) clearInterval(target.ticker);
      servers.delete(connectionId);
      changed();
    },

    async snapshot(connectionId, refresh) {
      await wait(refresh ? latency : 20);
      const target = server(connectionId);
      if (refresh && target.snapshot.state.phase === 'online') target.snapshot.statusObservedAtMs = Date.now();
      return clone(target.snapshot);
    },

    async subscribe(connectionId, topic, onEvent): Promise<Unsubscribe> {
      await wait(30);
      const target = server(connectionId);
      const topics = subscribers.get(connectionId) ?? new Map();
      subscribers.set(connectionId, topics);
      const set: Set<(event: ServerEvent) => void> = topics.get(topic) ?? new Set();
      topics.set(topic, set);
      set.add(onEvent);
      if (topic === 'status') {
        onEvent({ kind: 'snapshot', snapshot: clone(target.snapshot) });
        onEvent({ kind: 'players', players: rosterOf(target) });
      }
      if (topic === 'console') onEvent({ kind: 'console', lines: clone(target.console.slice(-16)) });
      if (target.snapshot.state.phase === 'online') ensureTicker(target);
      return () => { set.delete(onEvent); stopTickerIfIdle(target); };
    },

    async lifecycle(connectionId, action, expectedGeneration, intentId) {
      await wait();
      const target = server(connectionId);
      requireOnline(target);
      requireCapability(target, `lifecycle.${action}`);
      const replayed = replay(target, intentId, { action, expectedGeneration });
      if (replayed) return replayed;
      const current = target.snapshot.status;
      if (action === 'start' && current?.state !== 'stopped') fail('stale_target');
      if (action !== 'start' && (current?.state !== 'running' || current.generation !== expectedGeneration)) fail('stale_target');
      const operation = record(target, `lifecycle.${action}`, { kind: 'lifecycle', action, targetGeneration: expectedGeneration, resultGeneration: null });
      remember(target, intentId, { action, expectedGeneration }, operation);
      setTimeout(() => advance(target, operation, 'running'), 300);
      if (action === 'start' || action === 'restart') {
        if (action === 'restart') { setState(target, 'stopping', null); line(target, '[Server thread/INFO]: Stopping server'); }
        setTimeout(() => {
          setState(target, 'running', null);
          line(target, '[Server thread/INFO]: Starting minecraft server version 1.21.4');
          ensureTicker(target);
        }, action === 'restart' ? 2200 : 600);
        setTimeout(() => {
          if (target.snapshot.status) target.snapshot.status = { ...target.snapshot.status, readiness: 'ready', playerCount: 0, playerCountKnown: true, playerCountObservedAtMs: Date.now() };
          target.snapshot.restartRequired = false;
          target.online = [];
          line(target, '[Server thread/INFO]: Done (4.812s)! For help, type "help"');
          advance(target, operation, 'succeeded');
          publish(target);
        }, action === 'restart' ? 4400 : 3200);
      } else {
        setState(target, 'stopping', target.snapshot.status?.playerCount ?? null);
        line(target, '[Server thread/INFO]: Stopping server');
        // A stop that hangs lets the preview reach the Force kill control.
        if (target.snapshot.connection.name.includes('hang')) return clone(operation);
        setTimeout(() => {
          setState(target, 'stopped', null);
          target.online = [];
          advance(target, operation, 'succeeded');
        }, 3500);
      }
      return clone(operation);
    },

    async killPrepare(connectionId, expectedGeneration, intentId) {
      await wait();
      const target = server(connectionId);
      requireOnline(target);
      requireCapability(target, 'lifecycle.force_kill');
      if (target.snapshot.status?.generation !== expectedGeneration) fail('stale_target');
      const expiresAtMs = Date.now() + 120_000;
      target.pending.set(intentId, { kind: 'kill', expiresAtMs, generation: expectedGeneration });
      return { operationId: `op-${hex(10)}`, expiresAtMs };
    },

    async killConfirm(connectionId, intentId) {
      await wait();
      const target = server(connectionId);
      const replayed = replay(target, intentId, { kill: true });
      if (replayed) return replayed;
      const pending = target.pending.get(intentId);
      if (!pending || pending.kind !== 'kill') return fail('conflict');
      if (pending.expiresAtMs < Date.now()) fail('confirmation_expired');
      requireCapability(target, 'lifecycle.force_kill');
      const current = target.snapshot.status;
      if (current?.generation !== pending.generation || (current.state !== 'stopping' && current.state !== 'draining')) {
        target.pending.delete(intentId);
        fail('stale_target');
      }
      target.pending.delete(intentId);
      const operation = record(target, 'lifecycle.kill', { kind: 'lifecycle', action: 'kill', targetGeneration: pending.generation, resultGeneration: null });
      remember(target, intentId, { kill: true }, operation);
      setTimeout(() => {
        setState(target, 'stopped', null);
        target.online = [];
        advance(target, operation, 'succeeded');
      }, 800);
      return clone(operation);
    },

    async operations(connectionId, cursor): Promise<Page<ServerOperation>> {
      await wait();
      const target = server(connectionId);
      requireCapability(target, 'tasks.view');
      const start = cursor ? Number(cursor) : 0;
      const items = target.operations.slice(start, start + 50);
      return { items: clone(items), nextCursor: start + 50 < target.operations.length ? String(start + 50) : null };
    },

    async consolePage(connectionId, cursor, limit) {
      await wait();
      const target = server(connectionId);
      requireCapability(target, 'console.read');
      if (cursor && !target.console.some((entry) => entry.cursor === cursor)) fail('conflict');
      const start = cursor
        ? target.console.findIndex((entry) => entry.cursor === cursor) + 1
        : Math.max(0, target.console.length - limit);
      const items = target.console.slice(start, start + limit);
      return { items: clone(items), nextCursor: items.at(-1)?.cursor ?? cursor ?? String(target.cursor), latestCursor: String(target.cursor) };
    },

    async consoleSend(connectionId, text, expectedGeneration, intentId) {
      await wait();
      const target = server(connectionId);
      requireOnline(target);
      requireCapability(target, 'console.write');
      const replayed = replay(target, intentId, { text, expectedGeneration });
      if (replayed) return replayed;
      if (target.snapshot.status?.state !== 'running' || target.snapshot.status.generation !== expectedGeneration) fail('stale_target');
      const operation = record(target, 'console.command', { kind: 'console.command', command: text });
      remember(target, intentId, { text, expectedGeneration }, operation);
      setTimeout(() => {
        line(target, `[Server thread/INFO]: [Rcon: ${text}]`);
        advance(target, operation, 'succeeded');
      }, 250);
      return clone(operation);
    },

    async players(connectionId): Promise<PlayersView> {
      await wait();
      const target = server(connectionId);
      requireCapability(target, 'players.view');
      return rosterOf(target);
    },
    async whitelist(connectionId) { await wait(); const target = server(connectionId); requireCapability(target, 'players.view'); return clone(target.whitelist); },
    async offlineWhitelist(connectionId) { await wait(); const target = server(connectionId); requireOnline(target); requireCapability(target, 'players.view'); return { items: clone(target.whitelist), sha256: await whitelistHash(target) }; },
    async offlineWhitelistUpdate(connectionId, player, add, expected, intentId): Promise<string> {
      await wait(); const target = server(connectionId); requireOnline(target); requireCapability(target, 'players.moderate');
      const payload = JSON.stringify({ player, add, expected });
      const key = `${connectionId}:${intentId}`;
      const receipt = offlineReceipts.get(key);
      if (receipt) { if (receipt.payload !== payload) return fail('conflict'); return receipt.sha256; }
      if (target.snapshot.status?.state !== 'stopped' || target.snapshot.status.generation) return fail('stale_target');
      if (expected !== await whitelistHash(target)) return fail('conflict');
      if (add && !target.whitelist.some((entry) => entry.name.toLowerCase() === player.toLowerCase())) target.whitelist.push({ name: player, uuid: crypto.randomUUID() });
      if (!add) target.whitelist = target.whitelist.filter((entry) => entry.name.toLowerCase() !== player.toLowerCase());
      const sha256 = await whitelistHash(target); offlineReceipts.set(key, { payload, sha256 }); return sha256;
    },
    async operators(connectionId) { await wait(); const target = server(connectionId); requireCapability(target, 'players.view'); return clone(target.ops); },
    async bans(connectionId) { await wait(); const target = server(connectionId); requireCapability(target, 'players.view'); return clone(target.bans); },

    async moderate(connectionId, request, expectedGeneration, intentId): Promise<ModerationResult> {
      await wait();
      const target = server(connectionId);
      requireOnline(target);
      requireCapability(target, request.action === 'op' || request.action === 'deop' ? 'players.operator' : 'players.moderate');
      const replayed = replay(target, intentId, { request, expectedGeneration });
      if (replayed) return { kind: 'operation', operation: replayed };
      if (target.snapshot.status?.generation !== expectedGeneration) fail('stale_target');
      if (request.action === 'op') {
        const expiresAtMs = Date.now() + 120_000;
        target.pending.set(intentId, { kind: 'op', expiresAtMs, generation: expectedGeneration, request });
        return { kind: 'awaitingConfirmation', expiresAtMs };
      }
      const operation = applyModeration(target, request);
      remember(target, intentId, { request, expectedGeneration }, operation);
      return { kind: 'operation', operation: clone(operation) };
    },

    async moderateConfirm(connectionId, intentId) {
      await wait();
      const target = server(connectionId);
      const pending = target.pending.get(intentId);
      if (!pending?.request) {
        const confirmed = target.intents.get(intentId);
        return confirmed ? clone(confirmed.operation) : fail('conflict');
      }
      if (pending.expiresAtMs < Date.now()) fail('confirmation_expired');
      requireCapability(target, 'players.operator');
      if (target.snapshot.status?.generation !== pending.generation) {
        target.pending.delete(intentId);
        fail('stale_target');
      }
      target.pending.delete(intentId);
      const operation = applyModeration(target, pending.request);
      remember(target, intentId, { request: pending.request, expectedGeneration: pending.generation }, operation);
      return clone(operation);
    },

    onChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    ...createFileFixtures({ wait, server, requireOnline, requireCapability, publish }),

    // Backups, access and pack.
    ...createPresenceFixtures({ server, requireCapability, wait } as never),
    ...manage,
    ...createBrandingFixtures({ server, requireCapability, wait, devices: manage.devices } as never),
    // Workflows and run history.
    ...createAutomationFixtures({ server, requireCapability, wait, principals }),
  };

  function applyModeration(target: FixtureServer, request: ModerationAction) {
    const operation = record(target, 'players.moderate', { kind: 'players.moderate', action: request.action, player: request.player, reason: 'reason' in request ? request.reason ?? null : null, durationSeconds: request.action === 'ban' ? request.durationSeconds ?? null : null });
    const { player } = request;
    switch (request.action) {
      case 'kick': target.online = target.online.filter((name) => name !== player); line(target, `[Server thread/INFO]: Kicked ${player}: ${request.reason ?? 'Kicked by an operator'}`); break;
      case 'ban':
        target.online = target.online.filter((name) => name !== player);
        target.bans.push({ name: player, uuid: crypto.randomUUID(), reason: request.reason ?? 'Banned by an operator.', created: new Date().toISOString(), expires: request.durationSeconds ? new Date(Date.now() + request.durationSeconds * 1000).toISOString() : 'forever', source: 'Server' });
        break;
      case 'pardon': target.bans = target.bans.filter((entry) => entry.name !== player); break;
      case 'whitelist_add': if (!target.whitelist.some((entry) => entry.name === player)) target.whitelist.push({ name: player, uuid: crypto.randomUUID() }); break;
      case 'whitelist_remove': target.whitelist = target.whitelist.filter((entry) => entry.name !== player); break;
      case 'op': target.ops.push({ name: player, uuid: crypto.randomUUID(), level: 4, bypassesPlayerLimit: false }); break;
      case 'deop': target.ops = target.ops.filter((entry) => entry.name !== player); break;
      default: line(target, `[Server thread/INFO]: ${request.action} ${player}`);
    }
    if (target.snapshot.status && target.snapshot.status.playerCountKnown) target.snapshot.status.playerCount = target.online.length;
    setTimeout(() => advance(target, operation, 'succeeded'), 300);
    publish(target);
    return operation;
  }

  return api;
}
