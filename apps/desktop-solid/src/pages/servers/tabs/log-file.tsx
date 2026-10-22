import { Badge, IconButton } from '@vesta/ui';
import { Show, createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { LogView } from '../../../components/log-view/log-view';
import { LOG_LEVELS, type LogEntry, type LogViewState } from '../../../components/log-view/log-model';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { parseLog } from '../../../features/instances/interaction-utils';
import { baseName, formatBytes, isArchivedLog, isLogPath } from '../../../features/servers/files-model';
import { serverCommand } from '../../../features/servers/store';
import { stableConnectionId } from '../../../features/servers/connection-id';
import type { LogPage, ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { ServerErrorNote } from '../parts';

const PAGE_LINES = 500;

/** Page text split into viewer rows; each row's id is its start byte, so pages merge in order. */
function rows(page: LogPage): LogEntry[] {
  const result: LogEntry[] = [];
  let offset = Number(page.startByte);
  const lines = page.text.endsWith('\n') ? page.text.slice(0, -1).split('\n') : page.text.split('\n');
  if (!page.text) return result;
  for (const line of lines) {
    result.push({ ...parseLog(line.replace(/\r$/, ''), offset), kind: 'line' });
    offset += new TextEncoder().encode(line).length + 1;
  }
  return result;
}

/**
 * Read-only server log: the tail first, earlier pages on request. Rotated `.log.gz`
 * archives are read through the agent's decompressed view.
 */
export function LogFile(props: {
  snapshot: ServerSnapshot; path: string; onClose: () => void; onSwitch: (path: string) => void; onDownload: (path: string) => void;
}) {
  const id = stableConnectionId(() => props.snapshot);
  const [lines, setLines] = createSignal<LogEntry[]>([], { name: 'server-log:lines' });
  const [earlier, setEarlier] = createSignal<string | null>(null, { name: 'server-log:earlier' });
  const [size, setSize] = createSignal<string | null>(null, { name: 'server-log:size' });
  const [binary, setBinary] = createSignal(false, { name: 'server-log:binary' });
  const [loading, setLoading] = createSignal(false, { name: 'server-log:loading' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-log:error' });
  const [logs, setLogs] = createSignal<string[]>([], { name: 'server-log:siblings' });
  const [state, setState] = createSignal<LogViewState & { hiddenUntil: number | null }>(
    { query: '', levels: [...LOG_LEVELS], follow: false, wrap: true, hiddenUntil: null }, { name: 'server-log:view' },
  );
  const patch = (next: Partial<LogViewState & { hiddenUntil: number | null }>) => setState((current) => ({ ...current, ...next }));
  const decompress = () => isArchivedLog(props.path);

  let sequence = 0;
  const loadTail = async (path: string) => {
    const request = ++sequence;
    setLoading(true); setError(null); setLines([]); setEarlier(null); setBinary(false);
    try {
      const page = await serverCommand((client) => client.logTail(id(), path, PAGE_LINES, isArchivedLog(path)));
      if (request !== sequence) return;
      setBinary(page.binary); setLines(rows(page)); setEarlier(page.prevByte); setSize(page.size);
    } catch (reason) { if (request === sequence) setError(reason as ServerCommandError); }
    finally { if (request === sequence) setLoading(false); }
  };
  const loadEarlier = async () => {
    const from = earlier();
    if (!from) return;
    const request = sequence;
    setLoading(true);
    try {
      const page = await serverCommand((client) => client.logLines(id(), props.path, from, PAGE_LINES, 'backward', decompress()));
      if (request !== sequence) return;
      setLines((current) => [...rows(page), ...current]);
      setEarlier(page.prevByte);
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setLoading(false); }
  };
  createEffect(() => props.path, (path) => { void loadTail(path); }, { name: 'server-log:load' });
  // The other logs in `logs/`, offered as sources like the instance console's log picker.
  createEffect(id, (connectionId) => {
    void serverCommand((client) => client.filesList(connectionId, 'logs', null))
      .then((page) => setLogs(page.items.filter((entry) => entry.kind === 'file' && isLogPath(`logs/${entry.name}`)).map((entry) => `logs/${entry.name}`)))
      .catch(() => {});
  }, { name: 'server-log:siblings' });

  const sources = createMemo(() => {
    const list = logs().includes(props.path) ? logs() : [props.path, ...logs()];
    return list.toSorted((a, b) => (a === 'logs/latest.log' ? -1 : b === 'logs/latest.log' ? 1 : b.localeCompare(a)))
      .map((path) => ({ value: path, label: baseName(path), description: isArchivedLog(path) ? t('server-files.archived-log') : undefined }));
  }, { name: 'server-log:sources' });

  return (
    <div data-vesta="server-console" class="server-log-file">
      <LogView
        lines={lines}
        state={state}
        patch={patch}
        hidden={() => state().hiddenUntil ?? -Infinity}
        canRestore={() => state().hiddenUntil !== null}
        onClearDisplay={() => patch({ hiddenUntil: (untrack(lines).at(-1)?.id ?? -1) + 1 })}
        onRestoreDisplay={() => patch({ hiddenUntil: null })}
        live={() => false}
        sourceKey={() => props.path}
        sources={sources}
        onSourceChange={props.onSwitch}
        ariaLabel={() => t('console.log-output', { name: baseName(props.path) })}
        emptyText={() => (loading() ? t('server-files.loading') : binary() ? t('server-files.binary') : t('server-files.log-empty'))}
        footerDetail={() => [size() ? formatBytes(size()!) : null, decompress() ? t('server-files.decompressed') : null].filter(Boolean).join(' · ') || undefined}
        toolbarExtras={
          <>
            <IconButton size="sm" variant="ghost" icon={<Icon name="icons/content/history" />} label={t('server-files.load-earlier')}
              disabled={!earlier() || loading()} onClick={() => void loadEarlier()} />
            <IconButton size="sm" variant="ghost" icon={<Icon name="icons/actions/download" />} label={t('server-files.download')} onClick={() => props.onDownload(props.path)} />
            <IconButton size="sm" variant="ghost" icon={<Icon name="icons/actions/close" />} label={t('server-files.back-to-files')} onClick={props.onClose} />
          </>
        }
        banner={
          <>
            <Show when={decompress()}>
              <div data-vesta="server-callout" data-tone="neutral" class="server-console-notice">
                <Badge size="sm" variant="soft">{t('server-files.decompressed')}</Badge>
                <span>{t('server-files.archived-note')}</span>
              </div>
            </Show>
            <ServerErrorNote error={error()} onRetry={() => void loadTail(props.path)} />
          </>
        }
      />
    </div>
  );
}
