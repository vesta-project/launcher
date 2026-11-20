// What fills one server's disk: a bar split by part (worlds, backups, mods...) and its biggest
// folders. Used inside Machine settings > Storage (a server row opens it) and in the server's
// own settings, for admins who don't own the machine.
import { For, Show, createSignal, onSettled } from 'solid-js';
import { t } from '../../localization';
import { age } from '../../features/servers/model';
import { formatStorage, partLabels } from '../../features/servers/host-removed';
import type { StorageParts } from '../../features/servers/native-hosts';
import type { ServerStorageView } from '../../features/servers/native-storage';
import type { ConnectionId } from '../../features/servers/native';
import { serverCommand, useServersClock } from '../../features/servers/store';
import './host-removed.css';

const ORDER: Array<keyof StorageParts> = ['worlds', 'backups', 'content', 'software', 'logs', 'trash', 'other'];

export function ServerStorageDetail(props: { connectionId: ConnectionId; compact?: boolean }) {
  const now = useServersClock();
  const [view, setView] = createSignal<ServerStorageView | null>(null, { name: 'server-storage:view' });
  const [failed, setFailed] = createSignal(false, { name: 'server-storage:failed' });
  onSettled(() => {
    void serverCommand((client) => client.storage(props.connectionId)).then(setView, () => setFailed(true));
  });

  const parts = () => {
    const value = view();
    if (!value) return [];
    return ORDER.map((part) => ({ part, bytes: value.parts[part] })).filter((item) => item.bytes > 0);
  };
  const measured = () => {
    const at = Date.parse(view()?.measuredAt ?? '');
    if (!Number.isFinite(at)) return t('vesta-server.storage.never');
    const ago = age(at, now());
    return t('vesta-server.storage.measured', { time: t(ago.message, { count: ago.count }) });
  };

  return (
    <div data-vesta="server-storage" data-compact={props.compact ? '' : undefined}>
      <Show when={view()} fallback={
        <p data-vesta="server-muted">{failed() ? t('vesta-server.storage.unavailable') : t('vesta-server.host.checking')}</p>
      }>
        {(value) => (
          <>
            <div data-vesta="server-storage-head">
              <strong>{formatStorage(value().bytes)}</strong>
              <span data-vesta="server-muted">{measured()}</span>
              <Show when={value().volume}>
                {(volume) => <span data-vesta="server-muted">{t('vesta-server.storage.on-volume', { name: volume().label, free: formatStorage(volume().freeBytes) })}</span>}
              </Show>
            </div>
            <Show when={value().bytes > 0}>
              <div data-vesta="server-storage-bar" role="img" aria-label={parts().map((item) => `${t(partLabels[item.part])} ${formatStorage(item.bytes)}`).join(', ')}>
                <For each={parts()}>
                  {(item) => <span data-part={item.part} style={{ 'flex-grow': String(item.bytes) }} />}
                </For>
              </div>
              <ul data-vesta="server-storage-legend">
                <For each={parts()}>
                  {(item) => (
                    <li><span data-part={item.part} aria-hidden="true" />{t(partLabels[item.part])}<span data-vesta="server-storage-size">{formatStorage(item.bytes)}</span></li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={!props.compact && value().largest.length}>
              <p data-vesta="server-storage-subhead">{t('vesta-server.storage.largest')}</p>
              <ul data-vesta="server-storage-folders">
                <For each={value().largest}>
                  {(folder) => (
                    <li><span data-vesta="server-storage-path" data-tip-overflow>{folder.path}</span><span data-vesta="server-storage-size">{formatStorage(folder.bytes)}</span></li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
