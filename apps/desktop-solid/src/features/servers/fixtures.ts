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
  pending: Map<string, { kind: 'kill' | 'op'; expiresAtMs: number; request?: ModerationAction }>;
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
    id, name, endpoint, serverId: `srv_${hex(12)}`, fingerprint: hex(64), role, signInMethod: role ? 'pairing_code' : 'minecraft',
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
    },
    online: ['Alex', 'RedstoneRae', 'Kai_builds'],
    operations: [
      { operationId: 'op-1', intent: 'lifecycle.restart', state: 'succeeded', progressPercent: 100, createdAtMs: now - 3_600_000, updatedAtMs: now - 3_540_000, finishedAtMs: now - 3_540_000, reconciling: false },
      { operationId: 'op-2', intent: 'console.command', state: 'succeeded', progressPercent: 100, createdAtMs: now - 1_200_000, updatedAtMs: now - 1_199_000, finishedAtMs: now - 1_199_000, reconciling: false },
    ],
    console: [],
    cursor: 0,
    whitelist: PLAYERS.slice(0, 5).map((name) => ({ name, uuid: crypto.randomUUID() })),
    ops: [{ name: 'Alex', uuid: crypto.randomUUID(), level: 4, bypassesPlayerLimit: false }],
    bans: [{ name: 'griefer_99', uuid: crypto.randomUUID(), reason: 'Griefing spawn', created: '2026-10-02 18:12:44 +0000', expires: 'forever', source: 'Server' }],
    pending: new Map(),
  };
  for (let index = 0; index < 40; index++) {
    survival.console.push({ cursor: String(++survival.cursor), text: sample(CHATTER).replace('{p}', sample(PLAYERS)), truncated: false });
  }
  const creative: FixtureServer = {
    snapshot: {
      connection: connection('fixture-creative', 'Build team', '192.168.1.40:8443', 'viewer'),
      state: { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
      info: { serverId: 'srv_build', name: 'Build team', agentVersion: '0.9.0', minecraftVersion: '1.20.1', packVersion: '1.0' },
      status: status('stopped', null, null),
      statusObservedAtMs: now - 20_000,
      pack: { hostedRevision: null, minimumRevision: null, status: 'unpublished' },
      capabilities: { source: 'role_defaults', granted: capabilitiesForRole('viewer') ?? [], refused: [] },
      restartRequired: false,
    },
    online: [], operations: [], console: [], cursor: 0, whitelist: [], ops: [], bans: [], pending: new Map(),
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
    online: [], operations: [], console: [], cursor: 0, whitelist: [], ops: [], bans: [], pending: new Map(),
  };
  return [survival, creative, away];
}

export function createFixtureServers(options: { seeded?: boolean; latencyMs?: number } = {}): ServersApi {
  const servers = new Map<ConnectionId, FixtureServer>((options.seeded ?? true ? seed() : []).map((server) => [server.snapshot.connection.id, server]));
  const discoveries = new Map<string, Discovery & { address: string }>();
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
  const publish = (target: FixtureServer) => {
    target.snapshot.statusObservedAtMs = Date.now();
    emit(target.snapshot.connection.id, 'status', { kind: 'snapshot', snapshot: clone(target.snapshot) });
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
  const record = (target: FixtureServer, intent: string): ServerOperation => {
    const now = Date.now();
    const operation: ServerOperation = { operationId: `op-${hex(10)}`, intent, state: 'queued', progressPercent: 0, createdAtMs: now, updatedAtMs: now, finishedAtMs: null, reconciling: false };
    target.operations.unshift(operation);
    emit(target.snapshot.connection.id, 'operations', { kind: 'operation', operation: clone(operation) });
    return operation;
  };
  const advance = (target: FixtureServer, operation: ServerOperation, state: ServerOperation['state']) => {
    operation.state = state;
    operation.updatedAtMs = Date.now();
    if (state === 'running') operation.progressPercent = 50;
    if (['succeeded', 'failed', 'cancelled', 'recovery_required'].includes(state)) {
      operation.finishedAtMs = operation.updatedAtMs;
      operation.progressPercent = 100;
    }
    emit(target.snapshot.connection.id, 'operations', { kind: 'operation', operation: clone(operation) });
  };
  const line = (target: FixtureServer, text: string) => {
    const entry = { cursor: String(++target.cursor), text, truncated: false };
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
      };
      discoveries.set(discovery.discoveryId, discovery);
      const { address: _, ...result } = discovery;
      return result;
    },

    async pair(discoveryId, code) {
      await wait(700);
      const discovery = discoveries.get(discoveryId) ?? fail('not_found');
      const normalized = normalizePairingCode(code);
      if (!isPairingCode(normalized)) fail('pair_code_invalid');
      if (normalized.startsWith('lost')) fail('pair_outcome_unknown');
      if (normalized.startsWith('bad')) fail('pair_code_invalid');
      const id = `fixture-${hex(6)}`;
      const name = discovery.endpoint.split(':')[0].replace(/^\[|\]$/g, '');
      const entry: FixtureServer = {
        snapshot: {
          connection: { ...connection(id, name, discovery.endpoint, 'owner'), serverId: discovery.serverId, fingerprint: discovery.fingerprint, lastConnectedAtMs: Date.now(), addedAtMs: Date.now() },
          state: { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
          info: { serverId: discovery.serverId, name, agentVersion: '0.9.0', minecraftVersion: '1.21.4', packVersion: '1.0' },
          status: status('stopped', null, null),
          statusObservedAtMs: Date.now(),
          pack: { hostedRevision: null, minimumRevision: null, status: 'unpublished' },
          capabilities: { source: 'session', granted: capabilitiesForRole('owner') ?? [], refused: [] },
          restartRequired: false,
        },
        online: [], operations: [], console: [], cursor: 0, whitelist: [], ops: [], bans: [], pending: new Map(),
      };
      servers.set(id, entry);
      discoveries.delete(discoveryId);
      changed();
      return clone(entry.snapshot);
    },

    async signInMinecraft(discoveryId) {
      await wait(900);
      const discovery = discoveries.get(discoveryId) ?? fail('not_found');
      const id = `fixture-${hex(6)}`;
      const name = discovery.endpoint.split(':')[0];
      const entry: FixtureServer = {
        snapshot: {
          connection: { ...connection(id, name, discovery.endpoint, null), serverId: discovery.serverId, fingerprint: discovery.fingerprint, signInMethod: 'minecraft' },
          state: { phase: 'online', access: 'no_management_access', retryAtMs: null, rateLimitedUntilMs: null, lastError: null },
          info: null, status: null, statusObservedAtMs: null, pack: null,
          capabilities: { source: 'session', granted: ['public.info', 'pack.download', 'pack.realtime'], refused: [] },
          restartRequired: false,
        },
        online: [], operations: [], console: [], cursor: 0, whitelist: [], ops: [], bans: [], pending: new Map(),
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
      if (topic === 'status') onEvent({ kind: 'snapshot', snapshot: clone(target.snapshot) });
      if (topic === 'console') onEvent({ kind: 'console', lines: clone(target.console.slice(-16)) });
      if (target.snapshot.state.phase === 'online') ensureTicker(target);
      return () => { set.delete(onEvent); stopTickerIfIdle(target); };
    },

    async lifecycle(connectionId, action, expectedGeneration, intentId) {
      await wait();
      const target = server(connectionId);
      requireOnline(target);
      requireCapability(target, `lifecycle.${action}`);
      const existing = target.operations.find((operation) => operation.operationId === intentId);
      if (existing) return clone(existing);
      const current = target.snapshot.status;
      if (action === 'start' && current?.state !== 'stopped') fail('stale_target');
      if (action !== 'start' && (current?.state !== 'running' || current.generation !== expectedGeneration)) fail('stale_target');
      const operation = record(target, `lifecycle.${action}`);
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
      target.pending.set(intentId, { kind: 'kill', expiresAtMs });
      return { operationId: `op-${hex(10)}`, expiresAtMs };
    },

    async killConfirm(connectionId, intentId) {
      await wait();
      const target = server(connectionId);
      const pending = target.pending.get(intentId);
      if (!pending || pending.kind !== 'kill') fail('conflict');
      if (pending!.expiresAtMs < Date.now()) fail('confirmation_expired');
      target.pending.delete(intentId);
      const operation = record(target, 'lifecycle.kill');
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
      const before = cursor ? target.console.findIndex((entry) => entry.cursor === cursor) : target.console.length;
      const end = before < 0 ? target.console.length : before;
      const items = target.console.slice(Math.max(0, end - limit), end);
      return { items: clone(items), nextCursor: end - limit > 0 ? items[0]?.cursor ?? null : null, latestCursor: String(target.cursor) };
    },

    async consoleSend(connectionId, text, expectedGeneration) {
      await wait();
      const target = server(connectionId);
      requireOnline(target);
      requireCapability(target, 'console.write');
      if (target.snapshot.status?.state !== 'running' || target.snapshot.status.generation !== expectedGeneration) fail('stale_target');
      const operation = record(target, 'console.command');
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
      const current = target.snapshot.status;
      if (current?.state !== 'running' || !current.generation || current.readiness !== 'ready') return { known: false };
      return { known: true, generation: current.generation, playerCount: target.online.length, names: [...target.online] };
    },
    async whitelist(connectionId) { await wait(); const target = server(connectionId); requireCapability(target, 'players.view'); return clone(target.whitelist); },
    async operators(connectionId) { await wait(); const target = server(connectionId); requireCapability(target, 'players.view'); return clone(target.ops); },
    async bans(connectionId) { await wait(); const target = server(connectionId); requireCapability(target, 'players.view'); return clone(target.bans); },

    async moderate(connectionId, request, expectedGeneration, intentId): Promise<ModerationResult> {
      await wait();
      const target = server(connectionId);
      requireOnline(target);
      requireCapability(target, request.action === 'op' || request.action === 'deop' ? 'players.operator' : 'players.moderate');
      if (target.snapshot.status?.generation !== expectedGeneration) fail('stale_target');
      if (request.action === 'op') {
        const expiresAtMs = Date.now() + 120_000;
        target.pending.set(intentId, { kind: 'op', expiresAtMs, request });
        return { kind: 'awaitingConfirmation', expiresAtMs };
      }
      return { kind: 'operation', operation: applyModeration(target, request) };
    },

    async moderateConfirm(connectionId, intentId) {
      await wait();
      const target = server(connectionId);
      const pending = target.pending.get(intentId);
      if (!pending?.request) fail('conflict');
      if (pending!.expiresAtMs < Date.now()) fail('confirmation_expired');
      target.pending.delete(intentId);
      return applyModeration(target, pending!.request!);
    },

    onChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };

  function applyModeration(target: FixtureServer, request: ModerationAction) {
    const operation = record(target, 'players.moderate');
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
    return clone(operation);
  }

  return api;
}
