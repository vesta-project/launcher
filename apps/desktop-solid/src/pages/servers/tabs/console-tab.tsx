import { Button, IconButton } from '@vesta/ui';
import { Show, createMemo, createSignal, untrack } from 'solid-js';
import { LogView } from '../../../components/log-view/log-view';
import type { LogEntry } from '../../../components/log-view/log-model';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { serverConsoleView, toLogEntries } from '../../../features/servers/console-view';
import { errorMessage } from '../../../features/servers/errors';
import { IntentMemo, consoleLineProblem } from '../../../features/servers/model';
import { busyIntent, operationStateMessage } from '../../../features/servers/operations-model';
import { consoleBuffer, consoleVersion, loadConsoleTail, putOperations, serverCommand, serverOperations, useServerTopic } from '../../../features/servers/store';
import type { ConsoleEntry } from '../../../features/servers/console-model';
import { clearConsoleDisplay, consoleDisplayBoundary } from '../../../features/servers/console-model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { stableConnectionId } from '../../../features/servers/connection-id';

const NOTICE_KEY = 'vesta:servers:console-notice-seen';

export function ConsoleTab(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  useServerTopic(id, 'console');
  const view = () => serverConsoleView(id());
  const viewState = () => view()[0]();
  const patch = (next: Parameters<ReturnType<typeof serverConsoleView>[1]>[0]) => view()[1](next);
  const [line, setLine] = createSignal('', { name: 'server-console:line' });
  const [sending, setSending] = createSignal(false, { name: 'server-console:sending' });
  /** The last command's operation, followed through the operations store. */
  const [sentOperation, setSentOperation] = createSignal<string | null>(null, { name: 'server-console:sent-operation' });
  const [failure, setFailure] = createSignal<{ message: MessageId; uncertain: boolean } | null>(null, { name: 'server-console:failure' });
  const [noticeSeen, setNoticeSeen] = createSignal(typeof localStorage !== 'undefined' && localStorage.getItem(NOTICE_KEY) === '1', { name: 'server-console:notice-seen' });
  const [loadingTail, setLoadingTail] = createSignal(false, { name: 'server-console:loading-tail' });
  const [tailLoaded, setTailLoaded] = createSignal(false, { name: 'server-console:tail-loaded' });
  const intents = new IntentMemo();
  const parsed = new WeakMap<ConsoleEntry, LogEntry>();

  const entries = createMemo(() => {
    consoleVersion(id());
    return toLogEntries(consoleBuffer(id()).entries, { label: t('servers.console.gap'), detail: t('servers.console.gap-latest-log') }, parsed);
  }, { name: 'server-console:entries' });
  const canWrite = () => gate(props.snapshot.capabilities, 'console.write') === 'allowed';
  const running = () => props.snapshot.status?.state === 'running' && !!props.snapshot.status.generation;
  const problem = () => (line() ? consoleLineProblem(line()) : null);
  const commandInFlight = () => busyIntent(serverOperations(id()), 'console.command');
  const sentState = () => {
    const operationId = sentOperation();
    const operation = operationId ? serverOperations(id()).find((entry) => entry.operationId === operationId) : undefined;
    // `succeeded` means the line reached Minecraft's input, not that Minecraft ran it.
    if (operation?.state === 'succeeded') return t('servers.console.delivered');
    return operation ? t(operationStateMessage(operation)) : null;
  };

  const send = async (event: Event) => {
    event.preventDefault();
    const text = line();
    const generation = props.snapshot.status?.generation;
    if (!text || problem() || !generation) return;
    // The same line on the same run after an uncertain outcome keeps its intent.
    const intentId = intents.idFor({ text, generation });
    setSending(true);
    setFailure(null);
    try {
      const operation = await serverCommand((client) => client.consoleSend(id(), text, generation, intentId));
      intents.settle();
      putOperations(id(), [{ ...operation, intent: operation.intent ?? 'console.command' }]);
      setSentOperation(operation.operationId);
      setLine('');
      patch({ follow: true });
    } catch (reason) {
      const error = reason as ServerCommandError;
      intents.settle(error);
      setFailure({ message: errorMessage(error), uncertain: intents.uncertain });
    } finally {
      setSending(false);
    }
  };

  const loadTail = async () => {
    setLoadingTail(true);
    try { await loadConsoleTail(id()); setTailLoaded(true); }
    catch { /* live output continues; the button stays available */ }
    finally { setLoadingTail(false); }
  };

  return (
    <div data-vesta="server-console">
      <LogView
        lines={entries}
        state={viewState}
        patch={patch}
        hidden={() => { entries(); return consoleDisplayBoundary(consoleBuffer(id()).entries, viewState()); }}
        canRestore={() => viewState().hiddenUntil !== null}
        onClearDisplay={() => patch(untrack(() => clearConsoleDisplay(consoleBuffer(id()).entries)))}
        onRestoreDisplay={() => patch({ hiddenUntil: null, hiddenAfterCursor: null })}
        live={() => true}
        sourceKey={id}
        ariaLabel={() => t('console.log-output', { name: t('console.live-output') })}
        emptyText={() => (running() ? t('servers.console.waiting') : t('servers.console.stopped'))}
        toolbarExtras={
          <IconButton
            size="sm"
            variant="ghost"
            icon={<Icon name="icons/content/history" />}
            label={t('servers.console.load-recent')}
            disabled={loadingTail() || tailLoaded()}
            onClick={() => void loadTail()}
          />
        }
        banner={
          <Show when={!noticeSeen()}>
            <div data-vesta="server-callout" data-tone="neutral" class="server-console-notice">
              <span>{t('servers.console.notice')}</span>
              <Button size="sm" variant="ghost" onClick={() => { localStorage.setItem(NOTICE_KEY, '1'); setNoticeSeen(true); }}>{t('servers.got-it')}</Button>
            </div>
          </Show>
        }
      />
      <Show when={canWrite()}>
        <form data-vesta="server-console-input" onSubmit={send}>
          <span aria-hidden="true">›</span>
          <input
            value={line()}
            onInput={(event) => { setLine(event.currentTarget.value); setFailure(null); setSentOperation(null); }}
            placeholder={running() ? t('servers.console.placeholder') : t('servers.console.stopped')}
            disabled={!running() || sending()}
            aria-label={t('servers.console.command')}
            aria-invalid={problem() ? 'true' : undefined}
            spellcheck="false"
            autocomplete="off"
          />
          <Button size="sm" type="submit" disabled={!running() || sending() || commandInFlight() || !line() || !!problem()}>
            {failure()?.uncertain ? t('servers.console.send-again') : t('servers.console.send')}
          </Button>
        </form>
        <Show when={problem() || failure() || sentState()}>
          <p data-vesta="server-console-feedback" data-problem={problem() || failure() ? '' : undefined} role="status">
            {problem()
              ? t(problem()!)
              : failure()
                ? `${t(failure()!.message)}${failure()!.uncertain ? ` ${t('servers.operation.uncertain-retry')}` : ''}`
                : sentState()}
          </p>
        </Show>
      </Show>
    </div>
  );
}
