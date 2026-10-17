import { Button, Dialog, TextField } from '@vesta/ui';
import { createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js';
import { Icon } from '../../components/icon';
import { fetchInstalled, type InstalledRow } from '../../features/browse/browse-api';
import {
  projectCompatibility,
  projectKey,
  selectInstallVersion,
  updateAvailable,
  type ResourceProject,
  type ResourceVersion,
} from '../../features/browse/browse-model';
import { loadVersions } from '../../features/browse/browse-projects';
import { instances } from '../../features/instances/catalog';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { closePicker, installFromPicker, installIntoNew, pickerProject } from './install-actions';

type Status =
  | { kind: 'checking' | 'ready' | 'installed' | 'update' }
  | { kind: 'warning' | 'incompatible'; reason: MessageId };

const statusLabels: Record<'checking' | 'ready' | 'installed' | 'update', MessageId> = {
  checking: 'browse.status-checking',
  ready: 'browse.status-ready',
  installed: 'browse.status-installed',
  update: 'browse.status-update',
};

interface Loaded {
  project: ResourceProject;
  /** Undefined when the version list could not be fetched; the install retries it. */
  versions: ResourceVersion[] | undefined;
  rows: Record<string, InstalledRow[]>;
}

/** Choose where a project goes. Each instance shows whether it fits, is installed or can update. */
export function InstancePickerDialog() {
  const [filter, setFilter] = createSignal('', { name: 'browsePickerFilter' });
  const [loaded, setLoaded] = createSignal<Loaded | undefined>(undefined, { name: 'browsePickerLoaded' });

  createEffect(
    () => pickerProject(),
    (project) => {
      setFilter('');
      setLoaded(undefined);
      if (!project) return;
      let cancelled = false;
      const entries = untrack(instances);
      void (async () => {
        const [versions, ...lists] = await Promise.all([
          loadVersions(project.source, project.id).catch(() => undefined),
          ...entries.map((entry) => fetchInstalled(entry.instance.id).catch(() => [] as InstalledRow[])),
        ]);
        if (cancelled) return;
        setLoaded({
          project,
          versions,
          rows: Object.fromEntries(entries.map((entry, index) => [entry.instance.id, lists[index]])),
        });
      })();
      return () => {
        cancelled = true;
      };
    },
  );

  const list = createMemo(
    () => {
      const project = pickerProject();
      const data = loaded();
      const needle = filter().trim().toLowerCase();
      if (!project) return [];
      return instances()
        .filter((entry) => !needle || entry.instance.name.toLowerCase().includes(needle))
        .map((entry) => {
          const instance = entry.instance;
          const status = ((): Status => {
            const compatibility = projectCompatibility(project, project.resource_type, instance);
            if (compatibility.kind === 'incompatible')
              return { kind: 'incompatible', reason: `browse.reason-${compatibility.reason}` };
            if (!data) return { kind: 'checking' };
            const row = data.rows[instance.id]?.find(
              (item) =>
                projectKey(item.platform.toLowerCase(), item.remote_id) === projectKey(project.source, project.id),
            );
            const choice = data.versions
              ? selectInstallVersion(data.versions, instance, project.resource_type, project.source)
              : undefined;
            if (data.versions && !choice && !row) return { kind: 'incompatible', reason: 'browse.reason-no-version' };
            if (row) return updateAvailable(row, choice) ? { kind: 'update' } : { kind: 'installed' };
            if (compatibility.kind === 'warning')
              return { kind: 'warning', reason: `browse.reason-${compatibility.reason}` };
            return { kind: 'ready' };
          })();
          return { instance, status };
        });
    },
    { name: 'browsePickerRows' },
  );

  return (
    <Dialog
      open={!!pickerProject()}
      onOpenChange={(open) => !open && closePicker()}
      size="md"
      title={t('browse.picker-title')}
      description={pickerProject() ? t('browse.picker-description', { name: pickerProject()!.name }) : undefined}
      footer={
        <Button
          size="sm"
          variant="outline"
          icon={<Icon name="icons/actions/add" size={14} />}
          onClick={() => {
            const project = pickerProject();
            if (project) void installIntoNew(project, project.resource_type);
          }}
        >
          {t('browse.picker-new-instance')}
        </Button>
      }
    >
      <div data-vesta="browse-picker">
        <TextField
          size="sm"
          aria-label={t('browse.picker-search')}
          placeholder={t('browse.picker-search')}
          icon={<Icon name="icons/content/search" size={14} />}
          value={filter()}
          onChange={setFilter}
        />
        <ul data-vesta="browse-picker-list">
          <For each={list()} keyed={(row) => row.instance.id}>
            {(row) => {
              const status = () => row().status;
              const disabled = () => !['ready', 'warning', 'update'].includes(status().kind);
              return (
                <li data-vesta="browse-picker-row" data-status={status().kind}>
                  <button
                    type="button"
                    data-vesta="browse-picker-choice"
                    disabled={disabled()}
                    onClick={() => {
                      const project = pickerProject();
                      if (project) void installFromPicker(project, project.resource_type, { ...row().instance });
                    }}
                  >
                    <img
                      data-vesta="browse-picker-icon"
                      src={row().instance.image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                    <span data-vesta="browse-picker-text">
                      <strong>{row().instance.name}</strong>
                      <span>
                        {row().instance.minecraftVersion} · {row().instance.modloader}
                      </span>
                    </span>
                    <span data-vesta="browse-picker-status" data-status={status().kind}>
                      <Show when={status().kind === 'installed'}>
                        <Icon name="icons/controls/check" size={12} />
                      </Show>
                      <Show
                        when={'reason' in status()}
                        fallback={t(statusLabels[status().kind as keyof typeof statusLabels])}
                      >
                        {t((status() as { reason: MessageId }).reason)}
                      </Show>
                    </span>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={!list().length}>
          <p data-vesta="browse-picker-empty">{t('browse.picker-empty')}</p>
        </Show>
      </div>
    </Dialog>
  );
}
