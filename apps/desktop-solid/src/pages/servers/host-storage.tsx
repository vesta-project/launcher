// Machine settings: how much disk the machine has and what uses it. The machine answers from
// its last background measurement, so this reads instantly; "Measure now" asks for a fresh one
// and the panel follows it until it finishes. Owners only, on machines with `storage`.
import { Button, Progress } from '@vesta/ui';
import { For, Show, createEffect, createSignal, onSettled } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import { age } from '../../features/servers/model';
import {
  biggestParts, formatStorage, hostHas, lifecycleProblem, lifecycleProblemLines, partLabels, volumeUse, type LifecycleProblem,
} from '../../features/servers/host-removed';
import { hostCommand, hostInfo } from '../../features/servers/hosts-store';
import type { HostStorage } from '../../features/servers/native-hosts';
import { useServersClock } from '../../features/servers/store';
import { Card as Panel } from '../settings/parts';
import './host-removed.css';

const POLL_MS = 2000;

export function StoragePanel(props: { hostId: string; refresh?: number }) {
  const now = useServersClock();
  const [storage, setStorage] = createSignal<HostStorage | null>(null, { name: 'host-storage:value' });
  const [problem, setProblem] = createSignal<LifecycleProblem | null>(null, { name: 'host-storage:problem' });
  const [asking, setAsking] = createSignal(false, { name: 'host-storage:asking' });
  const shown = () => hostHas(hostInfo(props.hostId), 'storage');

  const load = async () => {
    if (!shown()) return;
    try { setStorage(await hostCommand((client) => client.storage(props.hostId))); setProblem(null); }
    catch (reason) { setProblem(lifecycleProblem(reason)); }
  };
  onSettled(() => void load());
  // Removing, restoring or deleting changes the numbers; the host settings page bumps `refresh`.
  createEffect(() => props.refresh ?? 0, (count) => { if (count) void load(); });
  // Follow a running measurement until it lands.
  createEffect(() => storage()?.measuring ?? false, (measuring) => {
    if (!measuring) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  });

  const measure = async () => {
    setAsking(true);
    setProblem(null);
    try {
      await hostCommand((client) => client.measureStorage(props.hostId));
      setStorage((current) => (current ? { ...current, measuring: true } : current));
      await load();
    } catch (reason) { setProblem(lifecycleProblem(reason)); }
    finally { setAsking(false); }
  };

  const measured = () => {
    const at = Date.parse(storage()?.measuredAt ?? '');
    if (!Number.isFinite(at)) return t('vesta-server.storage.never');
    const ago = age(at, now());
    return t('vesta-server.storage.measured', { time: t(ago.message, { count: ago.count }) });
  };

  return (
    <Show when={shown()}>
      <Panel title={t('vesta-server.storage.title')} description={storage()?.measuring ? t('vesta-server.storage.measuring') : measured()} action={
        <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/refresh" />} disabled={asking() || !!storage()?.measuring}
          onClick={() => void measure()}>{t('vesta-server.storage.measure')}</Button>
      }>
        <Show when={storage()} fallback={<Show when={!problem()}><p data-vesta="server-muted" class="server-panel-note">{t('vesta-server.host.checking')}</p></Show>}>
          {(value) => (
            <div data-vesta="host-storage">
              <For each={value().volumes}>
                {(volume) => {
                  const use = () => volumeUse(volume);
                  return (
                    <div data-vesta="host-storage-volume" data-low={use().low ? '' : undefined}>
                      <Progress size="sm" value={use().fraction * 100} tone={use().low ? 'danger' : 'accent'}
                        label={<span data-vesta="host-storage-volume-label">{volume.label}<Show when={use().low}><span data-vesta="host-storage-low">{t('vesta-server.storage.low')}</span></Show></span>}
                        valueLabel={t('vesta-server.storage.free', { free: formatStorage(volume.freeBytes), value: formatStorage(volume.totalBytes) })} />
                    </div>
                  );
                }}
              </For>
              <ul data-vesta="host-storage-list">
                <For each={value().servers}>
                  {(server) => (
                    <li>
                      <Icon name="icons/rail/servers" size={16} />
                      <span data-vesta="host-storage-text">
                        <span data-vesta="host-storage-name" data-tip-overflow>{server.name}</span>
                        <span data-vesta="host-storage-meta">
                          {biggestParts(server.parts).map((part) => `${t(partLabels[part.part])} ${formatStorage(part.bytes)}`).join(' · ')}
                        </span>
                      </span>
                      <span data-vesta="host-storage-size">{formatStorage(server.bytes)}</span>
                    </li>
                  )}
                </For>
                <Show when={value().removed.count > 0}>
                  <li>
                    <Icon name="icons/actions/delete" size={16} />
                    <span data-vesta="host-storage-text">
                      <span data-vesta="host-storage-name">{t('vesta-server.storage.removed')}</span>
                      <span data-vesta="host-storage-meta">{t('vesta-server.host.servers-count', { count: value().removed.count })}</span>
                    </span>
                    <span data-vesta="host-storage-size">{formatStorage(value().removed.bytes)}</span>
                  </li>
                </Show>
                <Show when={value().backups.bytes > 0}>
                  <li>
                    <Icon name="icons/content/storage" size={16} />
                    <span data-vesta="host-storage-text"><span data-vesta="host-storage-name">{t('vesta-server.storage.backups')}</span></span>
                    <span data-vesta="host-storage-size">{formatStorage(value().backups.bytes)}</span>
                  </li>
                </Show>
                <Show when={value().caches.length > 0}>
                  <li>
                    <Icon name="icons/actions/download" size={16} />
                    <span data-vesta="host-storage-text"><span data-vesta="host-storage-name">{t('vesta-server.storage.caches')}</span></span>
                    <span data-vesta="host-storage-size">{formatStorage(value().caches.reduce((sum, cache) => sum + cache.bytes, 0))}</span>
                  </li>
                </Show>
                <Show when={value().other > 0}>
                  <li>
                    <Icon name="icons/content/folder" size={16} />
                    <span data-vesta="host-storage-text"><span data-vesta="host-storage-name">{t('vesta-server.storage.other')}</span></span>
                    <span data-vesta="host-storage-size">{formatStorage(value().other)}</span>
                  </li>
                </Show>
              </ul>
            </div>
          )}
        </Show>
        <Show when={problem()}>
          {(why) => <p data-vesta="server-callout" data-tone={why() === 'rate' ? 'warning' : 'danger'} role="alert">{t(lifecycleProblemLines[why()], { name: '', machine: '' })}</p>}
        </Show>
      </Panel>
    </Show>
  );
}
