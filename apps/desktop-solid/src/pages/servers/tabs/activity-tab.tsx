import { Button } from '@vesta/ui';
import { For, Show, createSignal, onSettled } from 'solid-js';
import { t } from '../../../localization';
import { age } from '../../../features/servers/model';
import { operationStateMessage, operationTitle } from '../../../features/servers/operations-model';
import { loadOperations, serverOperations, useServersClock } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { ServerErrorNote } from '../parts';

export function ActivityTab(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const id = () => props.snapshot.connection.id;
  const [error, setError] = createSignal<ServerCommandError | null>(null);
  const [loading, setLoading] = createSignal(false);
  const refresh = async () => {
    setLoading(true); setError(null);
    try { await loadOperations(id()); }
    catch (reason) { setError(reason as ServerCommandError); }
    finally { setLoading(false); }
  };
  onSettled(() => { void refresh(); });

  return (
    <div data-vesta="server-activity">
      <div data-vesta="server-players-bar">
        <p data-vesta="server-muted">{t('servers.activity.description')}</p>
        <Button size="sm" variant="ghost" disabled={loading()} onClick={() => void refresh()}>{t('common.retry')}</Button>
      </div>
      <ServerErrorNote error={error()} onRetry={() => void refresh()} />
      <Show when={serverOperations(id()).length > 0} fallback={<p data-vesta="server-muted">{t('servers.activity.empty')}</p>}>
        <ul data-vesta="server-operations">
          <For each={serverOperations(id())} keyed={(operation) => operation.operationId}>
            {(operation) => {
              const when = () => age(operation().createdAtMs, now());
              return (
                <li data-state={operation().state}>
                  <span data-vesta="server-operation-title">{t(operationTitle(operation()))}</span>
                  <span data-vesta="server-operation-state">{t(operationStateMessage(operation()))}</span>
                  <span data-vesta="server-operation-time">{t('servers.ago', { time: t(when().message, { count: when().count }) })}</span>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </div>
  );
}
