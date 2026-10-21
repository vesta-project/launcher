import { Button, IconButton } from '@vesta/ui';
import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { VirtualList } from '../../../components/virtual-list';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { errorMessage } from '../../../features/servers/errors';
import { IntentMemo, consoleLineProblem } from '../../../features/servers/model';
import { busyIntent, operationStateMessage } from '../../../features/servers/operations-model';
import { consoleBuffer, consoleVersion, loadConsoleTail, putOperations, serverCommand, serverOperations, useServerTopic } from '../../../features/servers/store';
import type { ConsoleEntry } from '../../../features/servers/console-model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';

const NOTICE_KEY = 'vesta:servers:console-notice-seen';

export function ConsoleTab(props: { snapshot: ServerSnapshot }) {
  const id = () => props.snapshot.connection.id;
  useServerTopic(id, 'console');
  const [viewport, setViewport] = createSignal<HTMLElement>();
  const [follow, setFollow] = createSignal(true, { name: 'server-console:follow' });
  const [line, setLine] = createSignal('');
  const [sending, setSending] = createSignal(false);
  /** The last command's operation, followed through the operations store. */
  const [sentOperation, setSentOperation] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<{ message: MessageId; uncertain: boolean } | null>(null);
  const [noticeSeen, setNoticeSeen] = createSignal(typeof localStorage !== 'undefined' && localStorage.getItem(NOTICE_KEY) === '1');
  const [loadingTail, setLoadingTail] = createSignal(false);
  const [tailLoaded, setTailLoaded] = createSignal(false);
  const intents = new IntentMemo();

  const entries = createMemo(() => { consoleVersion(id()); return [...consoleBuffer(id()).entries]; }, { name: 'server-console:entries' });
  const lineCount = createMemo(() => entries().reduce((count, entry) => count + (entry.kind === 'line' ? 1 : 0), 0), { name: 'server-console:line-count' });
  const canWrite = () => gate(props.snapshot.capabilities, 'console.write') !== 'denied';
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

  createEffect(() => ({ count: entries().length, follow: follow() }), ({ follow: following }) => {
    if (!following) return;
    queueMicrotask(() => { const element = viewport(); if (element) element.scrollTop = element.scrollHeight; });
  }, { name: 'server-console:follow-scroll' });

  const scroll = () => {
    const element = viewport();
    if (!element) return;
    setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 24);
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
      setFollow(true);
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
      <div data-vesta="pane-toolbar">
        <Button size="sm" variant="ghost" disabled={loadingTail() || tailLoaded()} onClick={() => void loadTail()}>
          {t('servers.console.load-recent')}
        </Button>
        <span data-vesta="server-console-count">{t('servers.console.lines', { count: lineCount() })}</span>
        <IconButton
          size="sm"
          variant="ghost"
          icon={<Icon name="icons/navigation/arrow-down" />}
          label={t('servers.console.follow')}
          aria-pressed={follow() ? 'true' : 'false'}
          onClick={() => setFollow(true)}
        />
      </div>
      <Show when={!noticeSeen()}>
        <div data-vesta="server-callout" data-tone="neutral" class="server-console-notice">
          <span>{t('servers.console.notice')}</span>
          <Button size="sm" variant="ghost" onClick={() => { localStorage.setItem(NOTICE_KEY, '1'); setNoticeSeen(true); }}>{t('servers.got-it')}</Button>
        </div>
      </Show>
      <div data-vesta="server-console-output" ref={setViewport} onScroll={scroll} tabindex={0} role="log" aria-live="off">
        <Show when={entries().length} fallback={<p data-vesta="console-empty">{running() ? t('servers.console.waiting') : t('servers.console.stopped')}</p>}>
          <VirtualList items={entries()} key={(entry) => entry.key} rowHeight={20} scrollElement={viewport()}>
            {(entry) => <ConsoleRow entry={entry()} />}
          </VirtualList>
        </Show>
      </div>
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

function ConsoleRow(props: { entry: ConsoleEntry }) {
  return (
    <Show
      when={props.entry.kind === 'gap'}
      fallback={<div data-vesta="server-console-line" data-truncated={props.entry.kind === 'line' && props.entry.truncated ? '' : undefined}>{props.entry.kind === 'line' ? props.entry.text : ''}</div>}
    >
      <div data-vesta="server-console-gap" role="note">
        <span>{t('servers.console.gap')}</span>
        <span>{t('servers.console.gap-latest-log')}</span>
      </div>
    </Show>
  );
}
