// Lifecycle requests shared by the header, the server cards and the rail pins: one intent
// per action and run, so a retry after an uncertain outcome reuses it.
import { toast } from '@vesta/ui';
import { createSignal } from 'solid-js';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { errorMessage } from '../../features/servers/errors';
import { IntentMemo, lifecycleControls, type LifecycleAction } from '../../features/servers/model';
import { busyIntent } from '../../features/servers/operations-model';
import { putOperations, putSnapshot, serverCommand, serverOperations } from '../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../features/servers/native';

export const actionLabels: Record<LifecycleAction, MessageId> = {
  start: 'servers.lifecycle.start',
  sleep: 'servers.lifecycle.sleep',
  wake: 'servers.lifecycle.wake',
  stop: 'servers.lifecycle.stop',
  restart: 'servers.lifecycle.restart',
  kill: 'servers.lifecycle.kill',
};

export const actionIcons: Record<LifecycleAction, string> = {
  start: 'icons/actions/play',
  wake: 'icons/actions/play',
  sleep: 'icons/status/moon',
  stop: 'icons/actions/stop',
  restart: 'icons/actions/reload',
  kill: 'icons/actions/stop',
};

export type SubmittableAction = Exclude<LifecycleAction, 'kill'>;

export function useLifecycle(snapshot: () => ServerSnapshot) {
  const [busy, setBusy] = createSignal<LifecycleAction | null>(null, { name: 'server-lifecycle:busy' });
  const [uncertain, setUncertain] = createSignal(false, { name: 'server-lifecycle:uncertain' });
  const intents = new IntentMemo();
  const id = () => snapshot().connection.id;
  const pending = (action: LifecycleAction) => busyIntent(serverOperations(id()), `lifecycle.${action}`);

  const submit = async (action: SubmittableAction) => {
    if (busy()) return;
    // Wake and stop-from-sleeping have no running game to target.
    const generation = snapshot().status?.generation ?? null;
    const intentId = intents.idFor({ action, generation });
    setBusy(action);
    try {
      const operation = await serverCommand((client) => client.lifecycle(id(), action, generation, intentId));
      intents.settle();
      putOperations(id(), [{ ...operation, intent: operation.intent ?? `lifecycle.${action}` }]);
      toast.show({ title: t('servers.operation.accepted-toast', { name: t(actionLabels[action]) }), tone: 'neutral' });
    } catch (reason) {
      const error = reason as ServerCommandError;
      intents.settle(error);
      toast.show({ title: t(errorMessage(error)), tone: error.code === 'stale_target' ? 'warning' : 'danger' });
      if (error.code === 'stale_target') void serverCommand((client) => client.snapshot(id(), true)).then(putSnapshot).catch(() => {});
    } finally {
      setUncertain(intents.uncertain);
      setBusy(null);
    }
  };
  return { busy, uncertain, pending, submit };
}

export type Lifecycle = ReturnType<typeof useLifecycle>;

/** The quick action a card or pin offers: the header's primary, never Force kill. */
export function quickAction(snapshot: ServerSnapshot): SubmittableAction | null {
  const primary = lifecycleControls(snapshot).primary;
  return primary && primary !== 'kill' && primary !== 'restart' ? primary : null;
}
