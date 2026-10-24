// Fixture sleep policy and server-list presentation, with the agent's bounds, revisions
// and template validation.
import type { ConnectionId, ServerCommandError } from './native';
import { motdProblems, parseMotd, fillPlaceholders, MOTD_PLACEHOLDERS } from './motd-model';
import { PRESENCE_STATES, SLEEP_BOUNDS, type MotdDocument, type MotdPreview, type PresenceState, type SleepPolicy, type SleepPolicyView, type SleepBlocker } from './native-presence';

interface PresenceHost {
  server(id: ConnectionId): { snapshot: { status: { state: string; playerCount: number | null; sleepBlocker?: SleepBlocker | null } | null } };
  requireCapability(target: unknown, capability: string): void;
  wait(ms?: number): Promise<unknown>;
}

const fail = (code: ServerCommandError['code']): never => { throw { code, retryAfterMs: null } satisfies ServerCommandError; };
const clone = <T,>(value: T): T => structuredClone(value);

const defaultTemplates: Record<PresenceState, string> = {
  online: '§a{server_name}§r\n§7{online_players}/{max_players} online',
  offline: '§7{server_name} is offline',
  sleeping: '§b{server_name} is asleep\n§7Join to wake it up',
  waking: '§e{server_name} is waking up…\n§7Try again in a moment',
  starting: '§e{server_name} is starting',
  stopping: '§6{server_name} is stopping',
  maintenance: '§6Maintenance\n§7{maintenance_reason}',
  crash_loop: '§c{server_name} needs attention',
  recovery_required: '§cRecovery required',
};

function seedDocument(): MotdDocument {
  return {
    states: Object.fromEntries(PRESENCE_STATES.map((state) => [state, { template: defaultTemplates[state], versionName: null, maximumPlayers: null, iconPng: null }])) as MotdDocument['states'],
    normalIconPng: null,
    loginMessage: 'Server is starting; reconnect shortly.',
  };
}

export function createPresenceFixtures(host: PresenceHost) {
  const sleep = new Map<ConnectionId, SleepPolicyView>();
  const motd = new Map<ConnectionId, { document: MotdDocument; revision: string | null }>();
  const sleepOf = (id: ConnectionId) => {
    host.server(id);
    let value = sleep.get(id);
    if (!value) { value = { policy: { enabled: false, offlineStatus: false, wakeOnJoin: false, idleSeconds: 600, warningSeconds: 30, startCooldownSeconds: 30 }, revision: 0, sleepBlocker: { reason: 'disabled' } }; sleep.set(id, value); }
    const status = host.server(id).snapshot.status;
    value.sleepBlocker = !value.policy.enabled ? { reason: 'disabled' }
      : !status || status.state !== 'running' ? { reason: 'not_ready' }
      : status.playerCount === null ? { reason: 'player_count_unknown' }
      : status.playerCount > 0 ? { reason: 'players_online' }
      : { reason: 'counting_down', remainingSeconds: value.policy.idleSeconds };
    if (status) status.sleepBlocker = clone(value.sleepBlocker);
    return value;
  };
  const motdOf = (id: ConnectionId) => {
    host.server(id);
    let value = motd.get(id);
    if (!value) { value = { document: seedDocument(), revision: null }; motd.set(id, value); }
    return value;
  };
  const validate = (document: MotdDocument) => {
    for (const state of PRESENCE_STATES) {
      const presentation = document.states[state];
      if (!presentation || motdProblems(presentation.template).length) fail('invalid_input');
    }
  };
  return {
    async sleepPolicy(connectionId: ConnectionId) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'config.view');
      return clone(sleepOf(connectionId));
    },
    async updateSleepPolicy(connectionId: ConnectionId, policy: SleepPolicy, expectedRevision: number, _intentId: string) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'config.edit');
      const current = sleepOf(connectionId);
      if (current.revision !== expectedRevision) fail('stale_target');
      for (const [key, [min, max]] of Object.entries(SLEEP_BOUNDS)) {
        const value = policy[key as keyof typeof SLEEP_BOUNDS];
        if (!Number.isInteger(value) || value < min || value > max) fail('invalid_input');
      }
      // Sleeping stops Minecraft and waking starts it, so both need lifecycle authority.
      if (policy.enabled) host.requireCapability(host.server(connectionId), 'lifecycle.stop');
      if (policy.wakeOnJoin) host.requireCapability(host.server(connectionId), 'lifecycle.start');
      sleep.set(connectionId, { policy: clone(policy), revision: current.revision + 1, sleepBlocker: null });
      return clone(sleepOf(connectionId));
    },
    async motdPolicy(connectionId: ConnectionId) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'config.view');
      return clone(motdOf(connectionId));
    },
    async updateMotdPolicy(connectionId: ConnectionId, document: MotdDocument, expectedRevision: string | null, _intentId: string) {
      await host.wait();
      host.requireCapability(host.server(connectionId), 'config.edit');
      const current = motdOf(connectionId);
      if (current.revision !== expectedRevision) fail('stale_target');
      validate(document);
      const revision = String(Number(current.revision ?? 0) + 1);
      motd.set(connectionId, { document: clone(document), revision });
      return { document: clone(document), revision };
    },
    async motdPreview(connectionId: ConnectionId, state: PresenceState, document: MotdDocument): Promise<MotdPreview> {
      await host.wait(150);
      host.requireCapability(host.server(connectionId), 'config.view');
      const presentation = document.states[state] ?? fail('invalid_input');
      if (motdProblems(presentation.template).length) fail('invalid_input');
      const text = fillPlaceholders(presentation.template, { server_name: 'Riverside SMP', online_players: '0', max_players: String(presentation.maximumPlayers ?? 20), state, maintenance_reason: 'Updating mods' });
      const segments = parseMotd(text);
      const lines = [0, 1].map((line) => segments.filter((segment) => segment.line === line).map((segment) => segment.text).join('')) as [string, string];
      return { lines, segments, iconPng: presentation.iconPng ?? document.normalIconPng, placeholders: [...MOTD_PLACEHOLDERS] };
    },
  };
}
