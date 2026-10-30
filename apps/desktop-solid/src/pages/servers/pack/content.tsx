import { Badge, Button, Checkbox, Dialog, IconButton, Menu, MenuItem, MenuSeparator, SegmentedControl, Switch, TextField, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { navigate } from '../../../app/router';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { VirtualList } from '../../../components/virtual-list';
import { projectPath, sourceById } from '../../../features/browse/browse-model';
import { loadProjects, peekProject, peekVersions, prefetchProject } from '../../../features/browse/browse-projects';
import { browseForServer } from '../../../features/browse/browse-store';
import { IntentMemo } from '../../../features/servers/model';
import {
  bulkRemove, bulkRequiredTarget, bulkSetRequired, entryFileName, entryKindLabel, entryKinds, filterEntries, liveSelection, updateEntry,
  type EntryFilter,
} from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import type { PackEntry, PackManifest, PackSuggestion, PackSuggestions } from '../../../features/servers/native-pack';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';
import '../../library/instance/resources-tab.css';

const kindIcon: Record<PackEntry['kind'], string> = {
  mod: 'icons/content/cube',
  resource_pack: 'icons/content/resource-pack',
  shader: 'icons/content/monitor',
  datapack: 'icons/content/layers',
  config_override: 'icons/content/file',
};

const suggestionCopy: Record<PackSuggestion['kind'], { message: MessageId; action: MessageId | null }> = {
  client_mod_missing: { message: 'server-pack.suggest-missing', action: 'server-pack.suggest-add' },
  newer_compatible_version: { message: 'server-pack.suggest-newer', action: 'server-pack.suggest-update' },
  server_mod_removed: { message: 'server-pack.suggest-removed', action: 'server-pack.suggest-remove' },
  minecraft_version_drift: { message: 'server-pack.suggest-drift', action: null },
};

/** Content: the pack's entries, like an instance's Resources. Provider packs are read-only until Customize. */
export function ModpackContent() {
  const area = useModpackArea();
  const [pendingManifest, setPendingManifest] = createSignal<PackManifest | null>(null, { name: 'modpack-content:pending-manifest' });
  const manifest = () => pendingManifest() ?? area.workspace()!.draft.manifest;
  const readOnly = () => area.kind() === 'provider' || !!area.workspace()?.minecraftDrift;
  const [query, setQuery] = createSignal('', { name: 'modpack-content:query' });
  const [kind, setKind] = createSignal<EntryFilter>('all', { name: 'modpack-content:kind' });
  const [selected, setSelected] = createSignal<string[]>([], { name: 'modpack-content:selected' });
  const [removing, setRemoving] = createSignal<string[] | null>(null, { name: 'modpack-content:removing' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-content:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-content:error' });
  const [suggestions, setSuggestions] = createSignal<PackSuggestions | null>(null, { name: 'modpack-content:suggestions' });
  const [checking, setChecking] = createSignal(false, { name: 'modpack-content:checking' });
  const [suggestionError, setSuggestionError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-content:suggestion-error' });
  const [dismissed, setDismissed] = createSignal<ReadonlySet<string>>(new Set(), { name: 'modpack-content:dismissed' });
  const [viewport, setViewport] = createSignal<HTMLDivElement | undefined>(undefined, { name: 'modpack-content:viewport' });
  const adds = new IntentMemo();
  let disposed = false;
  let suggestionSequence = 0;
  onCleanup(() => { disposed = true; });

  // Provider names and icons, shared with Browse's cache.
  createEffect(() => manifest().entries, (entries) => {
    const byProvider = new Map<'modrinth' | 'curseforge', string[]>();
    for (const entry of entries) {
      if (entry.source.type !== 'provider') continue;
      const list = byProvider.get(entry.source.provider) ?? [];
      list.push(entry.source.projectId);
      byProvider.set(entry.source.provider, list);
    }
    for (const [provider, ids] of byProvider) void loadProjects(provider, ids).catch(() => {});
  }, { name: 'modpack-content:projects' });

  // Checking provider updates is optional work, not a prerequisite for displaying or
  // editing the draft. A required/optional switch must not start another catalogue scan.
  const checkSuggestions = async () => {
    if (untrack(checking) || untrack(busy)) return;
    const serverId = area.id();
    const revision = area.workspace()!.draft.revision;
    const request = ++suggestionSequence;
    setChecking(true); setSuggestionError(null);
    try {
      const value = await serverCommand((api) => api.packSuggestions(serverId));
      if (disposed || request !== suggestionSequence || serverId !== untrack(area.id) || revision !== untrack(area.workspace)?.draft.revision) return;
      if (value.draftRevision !== revision) { await area.reload(); return; }
      setSuggestions(value);
      const groups = new Map<'modrinth' | 'curseforge', string[]>();
      for (const item of value.items) if (item.provider) {
        const ids = groups.get(item.provider.provider) ?? [];
        ids.push(item.provider.projectId); groups.set(item.provider.provider, ids);
      }
      for (const [provider, ids] of groups) void loadProjects(provider, ids).catch(() => {});
    } catch (reason) {
      if (!disposed && request === suggestionSequence) setSuggestionError(reason as ServerCommandError);
    } finally { if (!disposed && request === suggestionSequence) setChecking(false); }
  };
  createEffect(() => area.workspace()!.draft.revision, () => {
    suggestionSequence++;
    setSuggestions(null); setChecking(false); setSuggestionError(null);
  }, { name: 'modpack-content:suggestions-stale' });

  const project = (entry: PackEntry) => (entry.source.type === 'provider' ? peekProject(entry.source.provider, entry.source.projectId) : undefined);
  const nameOf = (entry: PackEntry) => project(entry)?.name ?? entryFileName(entry);
  const kinds = createMemo(() => entryKinds(manifest().entries), { name: 'modpack-content:kinds' });
  const visible = createMemo(() => filterEntries(manifest().entries, query(), kinds().includes(kind() as never) ? kind() : 'all', nameOf), { name: 'modpack-content:visible' });
  const chosen = createMemo(() => liveSelection(selected(), manifest().entries), { name: 'modpack-content:chosen' });
  const allVisible = () => visible().length > 0 && visible().every((entry) => chosen().includes(entry.id));
  const someVisible = () => !allVisible() && visible().some((entry) => chosen().includes(entry.id));
  const updates = createMemo(() => new Map((suggestions()?.items ?? []).filter((item) => item.kind === 'newer_compatible_version' && item.entryId && item.provider).map((item) => [item.entryId!, item])), { name: 'modpack-content:updates' });
  const strip = () => (suggestions()?.items ?? []).filter((item) => item.kind !== 'newer_compatible_version' && !dismissed().has(item.id));

  const toggle = (id: string, on: boolean) => setSelected((list) => (on ? [...new Set([...list, id])] : list.filter((entry) => entry !== id)));
  const save = async (next: PackManifest, message?: MessageId) => {
    if (untrack(busy)) return false;
    setBusy(true); setError(null);
    // Only the editor is optimistic. The shared workspace remains server-confirmed,
    // so publication can never race ahead of an unacknowledged draft write.
    setPendingManifest(next);
    try {
      await area.writeManifest(next);
      if (!disposed && message) toast.show({ title: t(message), tone: 'success' });
      return true;
    } catch (reason) { if (!disposed) setError(reason as ServerCommandError); return false; }
    finally { if (!disposed) { setPendingManifest(null); setBusy(false); } }
  };
  const remove = async (ids: string[]) => {
    setRemoving(null);
    if (await save(bulkRemove(manifest(), ids), 'server-pack.removed')) setSelected([]);
  };
  const setRequired = (ids: string[], required: boolean) => void save(bulkSetRequired(manifest(), ids, required));
  const update = (entry: PackEntry) => {
    const item = updates().get(entry.id);
    if (item?.provider) void save(updateEntry(manifest(), entry.id, item.provider), 'server-pack.updated');
  };

  const accept = async (item: PackSuggestion) => {
    if (item.kind === 'client_mod_missing' && item.provider) {
      setBusy(true); setError(null);
      const request = { ...item.provider, expectedRevision: area.workspace()!.draft.revision, required: true, dependencies: [] };
      try {
        const draft = await serverCommand((api) => api.packAdd(area.id(), request, adds.idFor(request)));
        adds.settle();
        area.applyDraft(draft);
      } catch (reason) { adds.settle(reason as ServerCommandError); setError(reason as ServerCommandError); }
      finally { setBusy(false); }
    } else if (item.kind === 'server_mod_removed' && item.entryId) await remove([item.entryId]);
    else if (item.kind === 'minecraft_version_drift') area.open('overview');
  };

  const addContent = () => browseForServer({
    id: area.id(), name: area.snapshot().connection.name, type: 'mod', destination: 'modpack',
    minecraftVersion: area.workspace()!.serverMinecraftVersion, loader: manifest().loader === 'none' ? null : manifest().loader,
  });

  const versionLabel = (entry: PackEntry) => {
    if (entry.source.type !== 'provider') return t(entry.source.type === 'upload' ? 'server-pack.source-upload' : 'server-pack.source-manual');
    const { provider, projectId, versionId } = entry.source;
    return peekVersions(provider, projectId)?.find((version) => version.id === versionId)?.version_number ?? versionId;
  };
  const filterOptions = () => [
    { value: 'all', label: t('server-pack.filter-all') },
    ...kinds().map((value) => ({ value, label: t(entryKindLabel[value]) })),
  ];

  const row = (entry: () => PackEntry) => {
    const available = () => updates().get(entry().id);
    const link = () => (entry().source.type === 'provider' ? projectPath((entry().source as { provider: string }).provider, (entry().source as { projectId: string }).projectId) : undefined);
    const warm = () => { const source = entry().source; if (source.type === 'provider') prefetchProject(source.provider, source.projectId); };
    return (
      <div data-vesta="table-row" role="presentation" class={{ 'resource-row': true, 'row-selected': chosen().includes(entry().id) }}
        onPointerEnter={warm} onFocusIn={warm}>
        <div data-vesta="table-cell" role="cell" class="col-check">
          <Show when={!readOnly()}>
            <Checkbox size="sm" aria-label={t('server-pack.select-entry', { name: nameOf(entry()) })} disabled={busy()}
              checked={chosen().includes(entry().id)} onChange={(on) => toggle(entry().id, on)} />
          </Show>
        </div>
        <div data-vesta="table-cell" role="cell" class="col-name">
          <a data-vesta="resource-identity" href={link() ? `#${link()}` : undefined}
            onClick={(event) => { const path = link(); if (!path || event.button !== 0 || event.ctrlKey || event.metaKey) return; event.preventDefault(); navigate(path); }}>
            <Show when={project(entry())?.icon_url} fallback={
              <span data-vesta="server-content-placeholder" data-kind={entry().kind} aria-hidden="true"><Icon name={kindIcon[entry().kind]} size={14} /></span>
            }>
              {(src) => <img src={src()} alt="" loading="lazy" decoding="async" width={28} height={28} draggable="false" />}
            </Show>
            <span data-vesta="resource-copy">
              <span data-vesta="resource-title">{nameOf(entry())}</span>
              <span data-vesta="resource-sub">
                <Show when={entry().source.type === 'provider' ? entry().source as { provider: 'modrinth' | 'curseforge' } : undefined} fallback={
                  <span data-vesta="server-content-provider" data-unknown="">{t(entry().source.type === 'upload' ? 'server-pack.source-upload' : 'server-pack.source-manual')}</span>
                }>
                  {(source) => (
                    <span data-vesta="server-content-provider" data-provider={source().provider}>
                      <Icon name={sourceById(source().provider).icon} size={11} />{sourceById(source().provider).label}
                    </span>
                  )}
                </Show>
                <span data-vesta="resource-file" title={entry().path}>{entryFileName(entry())}</span>
              </span>
            </span>
          </a>
        </div>
        <div data-vesta="table-cell" role="cell" class="col-version">
          <span data-vesta="resource-version">
            <span title={versionLabel(entry())}>{versionLabel(entry())}</span>
            <Show when={!readOnly() && available()}>
              <IconButton size="sm" variant="ghost" class="resource-update" disabled={busy()} label={t('server-pack.update-entry', { name: nameOf(entry()) })}
                icon={<Icon name="icons/actions/download" />} onClick={() => update(entry())} />
            </Show>
          </span>
        </div>
        <div data-vesta="table-cell" role="cell" class="col-size">
          <Show when={entry().source.type === 'manual'} fallback={<span>{t(entryKindLabel[entry().kind])}</span>}>
            <Badge size="sm" tone="danger">{t('server-pack.needs-file')}</Badge>
          </Show>
        </div>
        <div data-vesta="table-cell" role="cell" class="col-enabled">
          <Switch size="sm" aria-label={t('server-pack.required-entry', { name: nameOf(entry()) })} checked={entry().required}
            disabled={readOnly()} readOnly={busy()} onChange={(on) => { if (!busy()) setRequired([entry().id], on); }} />
        </div>
        <div data-vesta="table-cell" role="cell" class="col-menu">
          <Show when={!readOnly()}>
            <Menu placement="bottom-end" trigger={(menuProps) => (
              <IconButton {...menuProps} variant="ghost" size="sm" tooltip={false} label={t('server-pack.entry-actions', { name: nameOf(entry()) })} icon={<Icon name="icons/content/ellipsis-v" />} />
            )}>
              <Show when={available()}>
                <MenuItem disabled={busy()} icon={<Icon name="icons/actions/download" />} onSelect={() => update(entry())}>{t('server-pack.update-entry', { name: nameOf(entry()) })}</MenuItem>
              </Show>
              <MenuItem disabled={busy()} icon={<Icon name="icons/controls/check" />} onSelect={() => setRequired([entry().id], !entry().required)}>
                {t(entry().required ? 'server-pack.make-optional' : 'server-pack.make-required')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem disabled={busy()} tone="danger" icon={<Icon name="icons/actions/delete" />} onSelect={() => setRemoving([entry().id])}>{t('server-pack.remove')}</MenuItem>
            </Menu>
          </Show>
        </div>
      </div>
    );
  };

  return (
    <div data-vesta="resources" data-modpack-content="">
      <div data-vesta="resources-toolbar" data-selecting={chosen().length ? '' : undefined}>
        <Show when={chosen().length} fallback={
          <div data-vesta="resources-tools" class="resources-bar">
            <Show when={kinds().length > 1}>
              <SegmentedControl size="sm" aria-label={t('server-pack.filter-label')} options={filterOptions()} value={kinds().includes(kind() as never) ? kind() : 'all'} onChange={(value) => setKind(value as EntryFilter)} />
            </Show>
            <TextField size="sm" class="resources-search" aria-label={t('server-pack.search')} placeholder={t('server-pack.search')}
              icon={<Icon name="icons/content/search" size={14} />} value={query()} onChange={setQuery} />
            <Show when={!readOnly()} fallback={
              <Button size="sm" variant="outline" icon={<Icon name="icons/actions/edit" />} onClick={() => area.open('overview')}>{t(area.workspace()?.minecraftDrift ? 'server-pack.repair' : 'server-pack.customize-to-edit')}</Button>
            }>
              <Button size="sm" variant="outline" disabled={checking() || busy()} onClick={() => void checkSuggestions()}>
                {t(checking() ? 'server-pack.checking-content' : 'server-pack.check-content')}
              </Button>
              <Button size="sm" tone="accent" disabled={busy()} icon={<Icon name="icons/actions/add" />} onClick={addContent}>{t('server-pack.add-content')}</Button>
            </Show>
          </div>
        }>
          <div data-vesta="resources-selection" class="resources-bar">
            <IconButton size="sm" variant="ghost" label={t('server-pack.clear-selection')} icon={<Icon name="icons/actions/close" />} onClick={() => setSelected([])} />
            <strong>{t('server-pack.selected', { count: chosen().length })}</strong>
            <span data-vesta="resources-selection-actions">
              <Button size="sm" variant="outline" disabled={busy()} onClick={() => setRequired(chosen(), bulkRequiredTarget(manifest().entries, chosen()))}>
                {t(bulkRequiredTarget(manifest().entries, chosen()) ? 'server-pack.make-required' : 'server-pack.make-optional')}
              </Button>
              <Button size="sm" tone="danger" icon={<Icon name="icons/actions/delete" />} disabled={busy()} onClick={() => setRemoving(chosen())}>{t('server-pack.remove-selected')}</Button>
            </span>
          </div>
        </Show>
      </div>

      <Show when={area.kind() === 'provider'}>
        <p data-vesta="server-callout" data-tone="neutral" class="modpack-note"><Icon name="icons/security/lock" size={14} /> {t('server-pack.content-read-only')}</p>
      </Show>
      <Show when={area.workspace()?.minecraftDrift}>
        <p data-vesta="server-callout" data-tone="warning" class="modpack-note" role="alert">{t('server-pack.drift', { version: area.workspace()!.serverMinecraftVersion })}</p>
      </Show>
      <Show when={strip().length}>
        <div data-vesta="modpack-suggestions" role="region" aria-label={t('server-pack.suggestions')}>
          <span data-vesta="modpack-suggestions-title"><Icon name="icons/status/info" size={14} />{t('server-pack.suggestions-count', { count: strip().length })}</span>
          <ul>
            <For each={strip()}>
              {(item) => (
                <li>
                  <span>{t(suggestionCopy[item.kind].message, { name: item.provider ? peekProject(item.provider.provider, item.provider.projectId)?.name ?? item.provider.projectId : item.path ?? '', version: area.workspace()!.serverMinecraftVersion })}</span>
                  <Show when={suggestionCopy[item.kind].action}>
                    {(action) => <Button size="sm" variant="outline" disabled={busy()} onClick={() => void accept(item)}>{t(action())}</Button>}
                  </Show>
                  <IconButton size="sm" variant="ghost" label={t('server-pack.dismiss')} icon={<Icon name="icons/actions/close" />}
                    onClick={() => setDismissed((current) => new Set([...current, item.id]))} />
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
      <ServerErrorNote error={error()} />
      <ServerErrorNote error={suggestionError()} />
      <span data-vesta="sr-only" role="status">{busy() ? t('server-pack.saving') : checking() ? t('server-pack.checking-content') : ''}</span>

      <div data-vesta="resources-list" aria-busy={busy() ? 'true' : 'false'} tabindex={0} ref={setViewport}>
        <Show when={visible().length} fallback={
          <EmptyState variant="inline" icon="icons/content/layers"
            title={t(query() ? 'server-pack.no-matches' : 'server-pack.content-empty')}
            description={query() ? undefined : t('server-pack.content-empty-hint')}>
            <Show when={query()} fallback={
              <Show when={!readOnly()}><Button size="sm" variant="outline" icon={<Icon name="icons/actions/add" />} onClick={addContent}>{t('server-pack.add-content')}</Button></Show>
            }>
              <Button size="sm" variant="outline" onClick={() => setQuery('')}>{t('common.clear-search')}</Button>
            </Show>
          </EmptyState>
        }>
          <div data-vesta="table-scroll" class="resource-table">
            <div data-vesta="table" role="table" aria-label={t('server-pack.tab-content')} aria-colcount={6} aria-rowcount={visible().length + 1}>
              <VirtualList items={visible()} key={(entry) => entry.id} rowHeight={44} scrollElement={viewport()} rowRole="row"
                headerHeight={32} headerHook="table-header" bodyHook="table-body"
                header={
                  <div data-vesta="table-row" role="row" aria-rowindex={1}>
                    <div data-vesta="table-head" role="columnheader" class="col-check">
                      <Show when={!readOnly()}>
                        <Checkbox size="sm" aria-label={t('server-pack.select-all')} checked={allVisible()} indeterminate={someVisible()}
                          onChange={(on) => setSelected((list) => (on ? [...new Set([...list, ...visible().map((entry) => entry.id)])] : list.filter((id) => !visible().some((entry) => entry.id === id))))} />
                      </Show>
                    </div>
                    <div data-vesta="table-head" role="columnheader" class="col-name">{t('resources.name-column')}</div>
                    <div data-vesta="table-head" role="columnheader" class="col-version">{t('resources.version-column')}</div>
                    <div data-vesta="table-head" role="columnheader" class="col-size">{t('server-pack.kind-column')}</div>
                    <div data-vesta="table-head" role="columnheader" class="col-enabled">{t('server-pack.required-column')}</div>
                    <div data-vesta="table-head" role="columnheader" class="col-menu"><span data-vesta="sr-only">{t('resources.actions-column')}</span></div>
                  </div>
                }>
                {(entry) => row(entry)}
              </VirtualList>
            </div>
          </div>
        </Show>
      </div>

      <Dialog open={!!removing()} onOpenChange={(open) => { if (!open) setRemoving(null); }} closeLabel={t('nav.close')} size="sm"
        title={t('server-pack.remove-title', { count: removing()?.length ?? 0 })} description={t('server-pack.remove-description')}
        footer={<>
          <Button variant="ghost" onClick={() => setRemoving(null)}>{t('common.cancel')}</Button>
          <Button tone="danger" onClick={() => { const ids = untrack(removing); if (ids) void remove(ids); }}>{t('server-pack.remove')}</Button>
        </>} />
    </div>
  );
}
