import { IconTile } from '../../../components/icon-tile';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Button, Dialog, SegmentedControl } from '@vesta/ui';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { instances } from '../../../features/instances/catalog';
import { setting } from '../../../features/settings/config';
import { storageUsage } from '../../../features/settings/resources';
import { formatBytes } from '../../../features/settings/storage-model';
import { t } from '../../../localization';
import { Card } from '../parts';
import './storage.css';

const hues = [250, 150, 85, 310, 200, 40, 20, 120];

export function StorageSettings() {
  const [view, setView] = createSignal('overview');
  const [confirming, setConfirming] = createSignal(false);
  /** The category (or instance) under the pointer or keyboard focus; the bar and legend share it. */
  const [hovered, setHovered] = createSignal<string | null>(null);
  const hover = (id: string) => ({
    onMouseEnter: () => setHovered(id),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(id),
    onBlur: () => setHovered(null),
  });
  const snapshot = () => storageUsage.data();
  const categories = createMemo(() =>
    snapshot()
      .categories.filter((category) => category.bytes > 0)
      .toSorted((a, b) => b.bytes - a.bytes),
  );
  const instanceRows = createMemo(() => {
    const known = new Map(instances().map((entry) => [entry.instance.id, entry.instance]));
    const largest = Math.max(...snapshot().instances.map((instance) => instance.bytes), 1);
    return snapshot()
      .instances.map((instance) => {
        const meta = known.get(String(instance.id));
        return {
          id: instance.id,
          name: instance.name,
          bytes: instance.bytes,
          image: meta?.image,
          detail: meta
            ? [meta.modloader === 'vanilla' ? null : meta.modloader, meta.minecraftVersion].filter(Boolean).join(' · ')
            : '',
          percent: instance.bytes > 0 ? Math.max((instance.bytes / largest) * 100, 2) : 0,
        };
      })
      .toSorted((a, b) => b.bytes - a.bytes);
  });
  const total = () => Math.max(snapshot().totalBytes, 1);
  const open = (command: string) =>
    isTauri() && void invoke(command, command === 'open_logs_folder' ? { instanceIdSlug: null } : undefined);
  const clear = async () => {
    setConfirming(false);
    if (isTauri())
      await invoke('clear_cache').catch((reason: unknown) => console.error('Unable to clear cache:', reason));
    await storageUsage.refresh(true);
  };
  return (
    <>
      <section data-vesta="prefs-usage">
        <div data-vesta="prefs-usage-head">
          <div>
            <span>{t('prefs.storage.total')}</span>
            <strong>{formatBytes(snapshot().totalBytes)}</strong>
          </div>
          <Button
            variant="ghost"
            disabled={storageUsage.refreshing()}
            icon={<Icon name="icons/actions/refresh" />}
            onClick={() => void storageUsage.refresh(true)}
          >
            {storageUsage.refreshing() ? t('prefs.storage.refreshing') : t('prefs.storage.refresh')}
          </Button>
        </div>
        <Show when={storageUsage.ready()} fallback={<div data-vesta="prefs-bar" data-empty="" />}>
          <div
            data-vesta="prefs-bar"
            role="img"
            aria-label={t('prefs.storage.usage')}
            data-hovering={hovered() !== null ? '' : undefined}
          >
            <For each={categories()}>
              {(category, index) => (
                <span
                  data-active={hovered() === category.label ? '' : undefined}
                  onMouseEnter={() => setHovered(category.label)}
                  onMouseLeave={() => setHovered(null)}
                  style={
                    {
                      '--part-hue': hues[index() % hues.length],
                      'flex-grow': category.bytes,
                    } as never
                  }
                  data-tip={`${category.label} · ${formatBytes(category.bytes)}`}
                />
              )}
            </For>
          </div>
        </Show>
        <SegmentedControl
          aria-label={t('prefs.storage.view')}
          value={view()}
          onChange={setView}
          options={[
            { value: 'overview', label: t('prefs.storage.overview') },
            { value: 'instances', label: t('prefs.storage.instances') },
            { value: 'cache', label: t('prefs.storage.cache') },
          ]}
        />
      </section>

      <Show when={view() === 'overview'}>
        <Card>
          <ul data-vesta="prefs-legend">
            <For each={categories()}>
              {(category, index) => (
                <li
                  tabindex={0}
                  data-active={hovered() === category.label ? '' : undefined}
                  data-tip={`${category.label} · ${formatBytes(category.bytes)} · ${Math.round((category.bytes / total()) * 100)}%`}
                  {...hover(category.label)}
                >
                  <i style={{ '--part-hue': hues[index() % hues.length] } as never} />
                  <span>{category.label}</span>
                  <b>{formatBytes(category.bytes)}</b>
                  <small>{Math.round((category.bytes / total()) * 100)}%</small>
                </li>
              )}
            </For>
          </ul>
        </Card>
      </Show>

      <Show when={view() === 'instances'}>
        <Card
          title={t('prefs.storage.instances')}
          description={t('prefs.storage.instances-total', {
            size: formatBytes(snapshot().instancesTotalBytes),
          })}
        >
          <Show
            when={instanceRows().some((row) => row.bytes > 0)}
            fallback={
              <p data-vesta="prefs-instance-empty" role="status">
                {storageUsage.refreshing() || !storageUsage.ready()
                  ? t('prefs.storage.instances-calculating')
                  : t('prefs.storage.instances-empty')}
              </p>
            }
          >
            <ul data-vesta="prefs-instances">
              <For each={instanceRows()}>
                {(row) => (
                  <li tabindex={0} data-empty={row.bytes <= 0 ? '' : undefined}>
                    <IconTile hook="prefs-instance-icon" size={28} image={row.image}>
                      <Show when={!row.image}>
                        <Icon name="icons/rail/library" size={14} />
                      </Show>
                    </IconTile>
                    <div data-vesta="prefs-instance-name">
                      <span>{row.name}</span>
                      <Show when={row.detail}>
                        <small>{row.detail}</small>
                      </Show>
                    </div>
                    <div data-vesta="prefs-instance-bar" aria-hidden="true">
                      <div style={{ 'inline-size': `${row.percent}%` }} />
                    </div>
                    <b>{formatBytes(row.bytes)}</b>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Card>
      </Show>

      <Show when={view() === 'cache'}>
        <Card title={t('prefs.storage.artifact-cache')} description={t('prefs.storage.artifact-cache-description')}>
          <div data-vesta="prefs-block">
            <div data-vesta="prefs-meter">
              <div>
                <strong>{formatBytes(snapshot().artifactCacheUsageBytes)}</strong>
                <span>
                  {t('prefs.downloads.cache-of', {
                    limit: formatBytes(setting('artifact_cache_max_bytes')),
                  })}
                </span>
              </div>
              <div data-vesta="prefs-bar" data-slim="">
                <span
                  style={
                    {
                      '--part-hue': 200,
                      'flex-grow': snapshot().artifactCacheUsageBytes,
                    } as never
                  }
                />
                <span
                  style={{
                    'flex-grow': Math.max(setting('artifact_cache_max_bytes') - snapshot().artifactCacheUsageBytes, 0),
                  }}
                  data-rest=""
                />
              </div>
            </div>
          </div>
        </Card>
      </Show>

      <Card title={t('prefs.storage.actions')}>
        <div data-vesta="prefs-actions">
          <Button
            variant="outline"
            icon={<Icon name="icons/content/folder" />}
            onClick={() => open('open_app_config_dir')}
          >
            {t('prefs.storage.open-data')}
          </Button>
          <Button
            variant="outline"
            icon={<Icon name="icons/content/folder" />}
            onClick={() => open('open_app_runtime_storage_dir')}
          >
            {t('prefs.storage.open-runtime')}
          </Button>
          <Button
            variant="outline"
            icon={<Icon name="icons/content/folder" />}
            onClick={() => open('open_logs_folder')}
          >
            {t('prefs.storage.open-logs')}
          </Button>
          <Button
            tone="danger"
            variant="outline"
            icon={<Icon name="icons/actions/delete" />}
            onClick={() => setConfirming(true)}
          >
            {t('prefs.storage.clear-cache')}
          </Button>
        </div>
      </Card>

      <Dialog
        closeLabel={t('nav.close')}
        size="sm"
        open={confirming()}
        onOpenChange={setConfirming}
        title={t('prefs.storage.clear-title')}
        description={t('prefs.storage.clear-description')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button tone="danger" onClick={() => void clear()}>
              {t('prefs.storage.clear-cache')}
            </Button>
          </>
        }
      />
    </>
  );
}
