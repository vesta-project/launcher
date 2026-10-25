// Plain-language sleep explanations (D3): why an enabled sleep timer isn't sleeping yet,
// and what a sleeping server tells the people looking at it.
import type { MessageId } from '../../localization/messages';
import type { ServerStatus } from './native';
import type { SleepBlocker, SleepPolicy } from './native-presence';

export interface SleepCopy {
  message: MessageId;
  args?: Record<string, string | number>;
  /** `waiting` explains a hold-up; `counting` is on its way to sleep; `asleep` is done. */
  kind: 'waiting' | 'counting' | 'asleep';
}

const WAITING: Record<Exclude<SleepBlocker['reason'], 'disabled' | 'counting_down' | 'warning_sent'>, MessageId> = {
  not_ready: 'servers.sleep-blocker.not-ready',
  players_online: 'servers.sleep-blocker.players-online',
  player_count_unknown: 'servers.sleep-blocker.player-count-unknown',
  operation_in_progress: 'servers.sleep-blocker.operation',
  hold: 'servers.sleep-blocker.hold',
  authority_unavailable: 'servers.sleep-blocker.authority',
};

/** Seconds left on a countdown, ticking down locally from when the status was observed. */
export function remainingSeconds(reported: number, observedAtMs: number | null, nowMs: number): number {
  const elapsed = observedAtMs === null ? 0 : Math.max(0, (nowMs - observedAtMs) / 1000);
  return Math.max(0, Math.ceil(reported - elapsed));
}

/**
 * The live sleep explanation for an enabled timer, or null when there's nothing to say
 * (sleep off, or an older agent without the diagnostic).
 */
export function sleepBlockerCopy(
  blocker: SleepBlocker | null | undefined,
  lifecycle: ServerStatus['lifecycle'] | undefined,
  observedAtMs: number | null = null,
  nowMs = observedAtMs ?? 0,
): SleepCopy | null {
  if (lifecycle === 'sleeping') return { message: 'servers.sleep-blocker.asleep', kind: 'asleep' };
  if (!blocker || blocker.reason === 'disabled') return null;
  if (blocker.reason === 'counting_down' || blocker.reason === 'warning_sent') {
    const seconds = remainingSeconds(blocker.remainingSeconds, observedAtMs, nowMs);
    const minutes = seconds >= 120;
    const warned = blocker.reason === 'warning_sent';
    const message: MessageId = warned
      ? (minutes ? 'servers.sleep-blocker.warned-minutes' : 'servers.sleep-blocker.warned-seconds')
      : (minutes ? 'servers.sleep-blocker.counting-minutes' : 'servers.sleep-blocker.counting-seconds');
    return { message, args: { count: minutes ? Math.round(seconds / 60) : seconds }, kind: 'counting' };
  }
  return { message: WAITING[blocker.reason], kind: 'waiting' };
}

/** "Sleeping · joins wake it" only when a join really can wake it. */
export function sleepingMessage(policy: Pick<SleepPolicy, 'offlineStatus' | 'wakeOnJoin'> | null | undefined): MessageId {
  return policy?.offlineStatus && policy.wakeOnJoin ? 'servers.minecraft.sleeping-wakes' : 'servers.minecraft.sleeping';
}

export type AgentStartChoice = NonNullable<SleepPolicy['onAgentStart']>;
export const AGENT_START_CHOICES: readonly AgentStartChoice[] = ['stay_stopped', 'sleep', 'start'];

/**
 * The startup choice to show: the saved one, else what the agent reports it inherits from
 * host.toml, else "stay stopped".
 */
export function agentStartChoice(policy: Pick<SleepPolicy, 'onAgentStart'> | null | undefined, status: Pick<ServerStatus, 'onAgentStart'> | null | undefined): AgentStartChoice {
  return policy?.onAgentStart ?? status?.onAgentStart ?? 'stay_stopped';
}

/** Sleep at startup needs the agent to answer the server list; the agent rejects it otherwise. */
export const agentStartAllowed = (choice: AgentStartChoice, policy: Pick<SleepPolicy, 'offlineStatus'>) =>
  choice !== 'sleep' || policy.offlineStatus;
