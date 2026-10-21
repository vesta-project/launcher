// Pure projections from native snapshots to what the server UI shows. Connection,
// access and Minecraft state are separate facts; unknown stays unknown.
import type { MessageId } from '../../localization/messages';
import type { Tone } from '@vesta/ui';
import { gate } from './capabilities';
import type { ServerErrorCode, ServerSnapshot, ServerStatus } from './native';

export interface Fact {
  tone: Tone;
  message: MessageId;
  args?: Record<string, string | number>;
  /** When set, the UI appends "seen … ago" built from this age. */
  seen?: { message: MessageId; count: number };
}

/** Coarse age for "seen … ago" copy. */
export function age(fromMs: number, nowMs: number): { message: MessageId; count: number } {
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (seconds < 60) return { message: 'servers.age.seconds', count: seconds };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { message: 'servers.age.minutes', count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { message: 'servers.age.hours', count: hours };
  return { message: 'servers.age.days', count: Math.round(hours / 24) };
}

export function connectionFact(snapshot: ServerSnapshot, nowMs: number): Fact {
  const { phase, retryAtMs, rateLimitedUntilMs } = snapshot.state;
  if (rateLimitedUntilMs && rateLimitedUntilMs > nowMs) {
    return { tone: 'warning', message: 'servers.connection.rate-limited', args: { count: Math.ceil((rateLimitedUntilMs - nowMs) / 1000) } };
  }
  switch (phase) {
    case 'online': return { tone: 'success', message: 'servers.connection.online' };
    case 'connecting': return { tone: 'neutral', message: 'servers.connection.connecting' };
    case 'backoff':
      return retryAtMs && retryAtMs > nowMs
        ? { tone: 'warning', message: 'servers.connection.retrying', args: { count: Math.ceil((retryAtMs - nowMs) / 1000) } }
        : { tone: 'warning', message: 'servers.connection.connecting' };
    case 'unreachable': return { tone: 'danger', message: 'servers.connection.unreachable' };
    default: return { tone: 'neutral', message: 'servers.connection.disconnected' };
  }
}

export function accessFact(snapshot: ServerSnapshot): Fact {
  switch (snapshot.state.access) {
    case 'fingerprint_changed': return { tone: 'danger', message: 'servers.access.fingerprint-changed' };
    case 'credentials_rejected': return { tone: 'danger', message: 'servers.access.rejected' };
    case 'credentials_unavailable': return { tone: 'warning', message: 'servers.access.vault-unavailable' };
    case 'no_management_access': return { tone: 'neutral', message: 'servers.access.no-management' };
    default:
      return snapshot.connection.role
        ? { tone: 'neutral', message: 'servers.access.paired-as', args: { name: roleLabel(snapshot.connection.role) } }
        : { tone: 'neutral', message: 'servers.access.signed-in' };
  }
}

export const roleLabel = (role: string) =>
  role.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

/** The Minecraft state, from lifecycle first (sleep, crash loop…), then process state and readiness. */
export function minecraftFact(status: ServerStatus | null): Fact {
  if (!status) return { tone: 'neutral', message: 'servers.minecraft.unknown' };
  switch (status.lifecycle) {
    case 'sleeping': return { tone: 'neutral', message: 'servers.minecraft.sleeping' };
    case 'waking': return { tone: 'accent', message: 'servers.minecraft.waking' };
    case 'crash_loop': return { tone: 'danger', message: 'servers.minecraft.crash-loop' };
    case 'recovery_required': return { tone: 'danger', message: 'servers.minecraft.recovery-required' };
    default: break;
  }
  if (status.supervisor?.crashLoop) return { tone: 'danger', message: 'servers.minecraft.crash-loop' };
  if (status.state === 'stopping' || status.state === 'draining') return { tone: 'warning', message: 'servers.minecraft.stopping' };
  if (status.state === 'stopped') return { tone: 'neutral', message: 'servers.minecraft.stopped' };
  switch (status.readiness) {
    case 'ready': return { tone: 'success', message: 'servers.minecraft.ready' };
    case 'degraded': return { tone: 'warning', message: 'servers.minecraft.degraded' };
    default: return { tone: 'accent', message: 'servers.minecraft.starting' };
  }
}

export const readinessReasonMessage: Record<NonNullable<ServerStatus['readinessReason']>, MessageId> = {
  startup_timeout: 'servers.readiness.startup-timeout',
  probe_failed: 'servers.readiness.probe-failed',
  fatal_output: 'servers.readiness.fatal-output',
  console_gap: 'servers.readiness.console-gap',
};

/** Supervisor conditions that mean control is limited, in display order. */
export function supervisorWarnings(status: ServerStatus | null): MessageId[] {
  const supervisor = status?.supervisor;
  if (!supervisor) return [];
  const warnings: MessageId[] = [];
  if (supervisor.orphanRunning) warnings.push('servers.supervisor.orphan');
  if (supervisor.launchUnresolved) warnings.push('servers.supervisor.launch-unresolved');
  if (supervisor.observationFailed) warnings.push('servers.supervisor.observation-failed');
  if (supervisor.restartStateUnsaved) warnings.push('servers.supervisor.restart-unsaved');
  return warnings;
}

/** Player count is never shown as 0 unless the server observed 0 for the running game. */
export function playersFact(status: ServerStatus | null, nowMs: number): Fact {
  if (!status) return { tone: 'neutral', message: 'servers.players.unknown' };
  if (status.state === 'stopped') return { tone: 'neutral', message: 'servers.players.none-running' };
  if (!status.playerCountKnown || status.playerCount === null) return { tone: 'neutral', message: 'servers.players.unknown' };
  if (status.playerCountObservedAtMs === null) {
    return { tone: 'neutral', message: 'servers.players.count', args: { count: status.playerCount } };
  }
  return { tone: 'neutral', message: 'servers.players.count', args: { count: status.playerCount }, seen: age(status.playerCountObservedAtMs, nowMs) };
}

export type LifecycleAction = 'start' | 'stop' | 'restart' | 'kill';

export interface LifecycleControls {
  /** Primary action button, or null when nothing applies. */
  primary: LifecycleAction | null;
  restart: boolean;
  /** Reason the controls are unavailable, if they are. */
  blocked: MessageId | null;
}

/** Start when stopped; Stop when running; Force kill replaces Stop while stopping. */
export function lifecycleControls(snapshot: ServerSnapshot): LifecycleControls {
  const caps = snapshot.capabilities;
  if (snapshot.state.phase !== 'online') return { primary: null, restart: false, blocked: 'servers.lifecycle.offline' };
  if (snapshot.state.access !== 'paired') return { primary: null, restart: false, blocked: 'servers.lifecycle.no-access' };
  const status = snapshot.status;
  if (!status) return { primary: null, restart: false, blocked: 'servers.lifecycle.unknown-state' };
  if (status.lifecycle === 'crash_loop' || status.lifecycle === 'recovery_required') {
    return { primary: null, restart: false, blocked: 'servers.lifecycle.needs-attention' };
  }
  const can = (capability: string) => gate(caps, capability) !== 'denied';
  if (status.state === 'stopped') {
    return { primary: can('lifecycle.start') ? 'start' : null, restart: false, blocked: can('lifecycle.start') ? null : 'servers.lifecycle.not-allowed' };
  }
  if (status.state === 'stopping' || status.state === 'draining') {
    const kill = can('lifecycle.force_kill') && status.generation !== null;
    return { primary: kill ? 'kill' : null, restart: false, blocked: kill ? null : 'servers.lifecycle.stopping' };
  }
  const stop = can('lifecycle.stop') && status.generation !== null;
  return {
    primary: stop ? 'stop' : null,
    restart: can('lifecycle.restart') && status.generation !== null,
    blocked: stop ? null : 'servers.lifecycle.not-allowed',
  };
}

/** Small status dot for the rail and server list. */
export type Dot = 'online' | 'starting' | 'stopped' | 'problem' | 'offline';

export function statusDot(snapshot: ServerSnapshot): Dot {
  if (snapshot.state.access === 'fingerprint_changed' || snapshot.state.access === 'credentials_rejected') return 'problem';
  if (snapshot.state.phase !== 'online') return 'offline';
  const fact = minecraftFact(snapshot.status);
  if (fact.tone === 'danger' || fact.tone === 'warning') return 'problem';
  if (fact.message === 'servers.minecraft.ready') return 'online';
  if (fact.message === 'servers.minecraft.starting' || fact.message === 'servers.minecraft.waking') return 'starting';
  return 'stopped';
}

/** Uptime from the server's decimal-string seconds, as `1d 3h`, `2h 5m` or `4m`. */
export function formatUptime(seconds: string | null): string | null {
  if (seconds === null || !/^\d+$/.test(seconds)) return null;
  const total = Number(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(minutes, 0)}m`;
}

/** A command line the server will accept: non-empty, ≤1,024 UTF-8 bytes, no control characters. */
export function consoleLineProblem(line: string): MessageId | null {
  if (!line.trim()) return 'servers.console.empty';
  if (new TextEncoder().encode(line).length > 1024) return 'servers.console.too-long';
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(line)) return 'servers.console.control-characters';
  return null;
}

/** Java Edition player names accepted by typed moderation. */
export const isPlayerName = (value: string) => /^[A-Za-z0-9_]{1,16}$/.test(value);

export function newIntentId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `intent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Rejections that prove the server did not act on this exact request. */
const DEFINITE_REJECTIONS: ReadonlySet<ServerErrorCode> = new Set([
  'invalid_address', 'pair_code_invalid', 'credentials_rejected', 'credentials_unavailable', 'no_management_access',
  'forbidden', 'not_found', 'stale_target', 'confirmation_expired', 'conflict', 'unsupported', 'invalid_input',
  'fingerprint_mismatch', 'tls_failed',
]);

/** True when the server may or may not have accepted the request (lost response, timeout, …). */
export const outcomeUncertain = (code: ServerErrorCode) => !DEFINITE_REJECTIONS.has(code);

/**
 * One intent id per user intent. Retrying the identical payload after an uncertain
 * outcome reuses the id, so the server's idempotency key collapses duplicates; a new
 * payload, a success or a definite rejection starts a new intent.
 */
export class IntentMemo {
  private last: { payload: string; id: string; uncertain: boolean } | null = null;

  constructor(private readonly create: () => string = newIntentId) {}

  idFor(payload: unknown): string {
    const key = JSON.stringify(payload);
    if (this.last && this.last.payload === key) return this.last.id;
    this.last = { payload: key, id: this.create(), uncertain: false };
    return this.last.id;
  }

  /** Record the outcome of the attempt made with `idFor`. */
  settle(error?: { code: ServerErrorCode } | null) {
    if (!this.last) return;
    if (error && outcomeUncertain(error.code)) this.last.uncertain = true;
    else this.last = null;
  }

  /** An earlier attempt may have reached the server; the UI says so and offers the same retry. */
  get uncertain() {
    return this.last?.uncertain ?? false;
  }
}

/** The Minecraft fact as shown while disconnected: the last known value, with its age. */
export function minecraftFactNow(snapshot: ServerSnapshot, nowMs: number): Fact {
  const fact = minecraftFact(snapshot.status);
  if (snapshot.state.phase === 'online' || !snapshot.status || snapshot.statusObservedAtMs === null) return fact;
  return { ...fact, tone: 'neutral', seen: age(snapshot.statusObservedAtMs, nowMs) };
}
