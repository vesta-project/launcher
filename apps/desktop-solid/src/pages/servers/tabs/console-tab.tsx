import { Button, IconButton } from '@vesta/ui';
import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { VirtualList } from '../../../components/virtual-list';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { gate } from '../../../features/servers/capabilities';
import { errorMessage } from '../../../features/servers/errors';
import { consoleLineProblem, newIntentId } from '../../../features/servers/model';
import { consoleBuffer, consoleVersion, loadEarlierConsole, putOperations, recoverConsoleGap, serverCommand, useServerTopic } from '../../../features/servers/store';
import type { ConsoleEntry } from '../../../features/servers/console-model';
import type { ServerSnapshot } from '../../../features/servers/native';

const NOTICE_KEY = 'vesta:servers:console-notice-seen';

export function ConsoleTab(props: { snapshot: ServerSnapshot }) {
  const id = () => props.snapshot.connection.id;
  useServerTopic(id, 'console');
  const [viewport, setViewport] = createSignal<HTMLElement>();
  const [follow, setFollow] = createSignal(true, { name: 'server-console:follow' });
  const [line, setLine] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [feedback, setFeedback] = createSignal<string | null>(null);
  const [recovered, setRecovered] = createSignal<Set<string>>(new Set());
  const [noticeSeen, setNoticeSeen] = createSignal(typeof localStorage !== 'undefined' && localStorage.getItem(NOTICE_KEY) === '1');
  const [loadingEarlier, setLoadingEarlier] = createSignal(false);
  const [moreEarlier, setMoreEarlier] = createSignal(true);

  const entries = createMemo(() => { consoleVersion(id()); return [...consoleBuffer(id()).entries]; }, { name: 'server-console:entries' });
  const lineCount = createMemo(() => entries().reduce((count, entry) => count + (entry.kind === 'line' ? 1 : 0), 0), { name: 'server-console:line-count' });
  const canWrite = () => gate(props.snapshot.capabilities, 'console.write') !== 'denied';
  const running = () => props.snapshot.status?.state === 'running' && !!props.snapshot.status.generation;
  const problem = () => (line() ? consoleLineProblem(line()) : null);

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
    setSending(true);
    setFeedback(null);
    try {
      const operation = await serverCommand((client) => client.consoleSend(id(), text, generation, newIntentId()));
      putOperations(id(), [{ ...operation, intent: operation.intent ?? 'console.command' }]);
      setLine('');
      setFeedback(t('servers.console.sent'));
      setFollow(true);
    } catch (reason) {
      setFeedback(t(errorMessage(reason)));
    } finally {
      setSending(false);
    }
  };

  const recover = async (key: string) => {
    setRecovered((current) => new Set(current).add(key));
    try { await recoverConsoleGap(id(), key); } catch { /* the marker stays; latest.log remains available */ }
  };

  const earlier = async () => {
    setLoadingEarlier(true);
    try { setMoreEarlier((await loadEarlierConsole(id())).more); }
    catch { setMoreEarlier(false); }
    finally { setLoadingEarlier(false); }
  };

  return (
    <div data-vesta="server-console">
      <div data-vesta="pane-toolbar">
        <Button size="sm" variant="ghost" disabled={loadingEarlier() || !moreEarlier()} onClick={() => void earlier()}>
          {t('servers.console.load-earlier')}
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
            {(entry) => <ConsoleRow entry={entry()} recovered={recovered().has(entry().key)} onRecover={(key) => void recover(key)} />}
          </VirtualList>
        </Show>
      </div>
      <Show when={canWrite()}>
        <form data-vesta="server-console-input" onSubmit={send}>
          <span aria-hidden="true">›</span>
          <input
            value={line()}
            onInput={(event) => { setLine(event.currentTarget.value); setFeedback(null); }}
            placeholder={running() ? t('servers.console.placeholder') : t('servers.console.stopped')}
            disabled={!running() || sending()}
            aria-label={t('servers.console.command')}
            aria-invalid={problem() ? 'true' : undefined}
            spellcheck="false"
            autocomplete="off"
          />
          <Button size="sm" type="submit" disabled={!running() || sending() || !line() || !!problem()}>{t('servers.console.send')}</Button>
        </form>
        <Show when={problem() || feedback()}>
          <p data-vesta="server-console-feedback" data-problem={problem() ? '' : undefined}>{problem() ? t(problem()!) : feedback()}</p>
        </Show>
      </Show>
    </div>
  );
}

function ConsoleRow(props: { entry: ConsoleEntry; recovered: boolean; onRecover: (key: string) => void }) {
  return (
    <Show
      when={props.entry.kind === 'gap' ? props.entry : undefined}
      fallback={<div data-vesta="server-console-line" data-truncated={props.entry.kind === 'line' && props.entry.truncated ? '' : undefined}>{props.entry.kind === 'line' ? props.entry.text : ''}</div>}
    >
      {(gap) => (
        <div data-vesta="server-console-gap">
          <span>{t('servers.console.gap')}</span>
          <Show when={!gap().recovered && !props.recovered} fallback={<span>{t('servers.console.gap-latest-log')}</span>}>
            <button type="button" onClick={() => props.onRecover(gap().key)}>{t('servers.console.gap-load')}</button>
          </Show>
        </div>
      )}
    </Show>
  );
}
