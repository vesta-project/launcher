import { Button, IconButton, Menu, MenuItem, MenuSeparator, SegmentedControl, Switch, TextField, toast } from '@vesta/ui';
import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { navigate } from '../../../app/router';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { VirtualList } from '../../../components/virtual-list';
import { browseForServer } from '../../../features/browse/browse-store';
import { projectPath, sourceById, type ResourceVersion } from '../../../features/browse/browse-model';
import { loadProject, loadProjects, loadVersionLists, peekProject, peekVersions, prefetchProject } from '../../../features/browse/browse-projects';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import {
  contentErrorMessage, contentGates, contentKinds, contentList, contentUpdate, datapackId, groupLabel, isModpackOwned, kindLabel, mutationRequest,
  pendingSummary, primaryKind, providerLookups, rowActions, updateRequest,
  type ContentFilter, type ContentListRow, type ContentRowModel,
} from '../../../features/servers/content-model';
import { lifecycleControls, newIntentId } from '../../../features/servers/model';
import { linkProvider, serverModpackPath } from '../../../features/servers/modpack-area-model';
import type { ContentChange, ServerContentEntry, ServerContentInventory } from '../../../features/servers/native-content';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { invalidateServerResources, readServerResource, useServerResource } from '../../../features/servers/resources';
import { CONTENT_RESOURCES, contentResource, packWorkspaceResource, worldResource } from '../../../features/servers/server-resources';
import { putOperations, serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { useLifecycle } from '../lifecycle';
import { ServerErrorNote } from '../parts';
import '../../library/instance/resources-tab.css';
import './resources-tab.css';

const kindIcon: Record<ServerContentEntry['kind'], string> = {
  mod: 'icons/content/cube',
  plugin: 'icons/content/dependencies',
  datapack: 'icons/content/layers',
};

/**
 * Server → Resources: what is actually on the server (mods, plugins, datapacks), with the
 * changes it has staged for the next restart. Independent of the client modpack draft.
 */
export function ServerResourcesTab(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const content = useServerResource(id, contentResource);
  // The server modpack link names the files it owns; reading it needs pack.edit.
  const pack = useServerResource(id, packWorkspaceResource, { enabled: () => gate(props.snapshot.capabilities, 'pack.edit') === 'allowed' });
  const owned = createMemo(() => new Set(Object.keys(pack.value()?.serverModpack?.files ?? {})), { name: 'server-content:owned' });
  const modpackSource = () => pack.value()?.serverModpack?.source ?? null;
  createEffect(() => { const value = linkProvider(modpackSource()); return value ? `${value.provider}:${value.projectId}` : null; }, (key) => {
    const value = key ? linkProvider(untrack(modpackSource)) : null;
    if (value) void loadProject(value.provider, value.projectId).catch(() => {});
  }, { name: 'server-content:modpack-project' });
  const modpackName = () => {
    const value = linkProvider(modpackSource());
    return (value ? peekProject(value.provider, value.projectId)?.name : undefined) ?? t('server-content.server-modpack');
  };
  const lifecycle = useLifecycle(() => props.snapshot);
  const [filter, setFilter] = createSignal<ContentFilter>('all', { name: 'server-content:filter' });
  const [query, setQuery] = createSignal('', { name: 'server-content:query' });
  const [menuKey, setMenuKey] = createSignal<string | null>(null, { name: 'server-content:menu' });
  const [expanded, setExpanded] = createSignal(true, { name: 'server-content:expanded' });
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set(), { name: 'server-content:busy' });
  const [viewport, setViewport] = createSignal<HTMLDivElement | undefined>(undefined, { name: 'server-content:viewport' });
  const [checking, setChecking] = createSignal(false, { name: 'server-content:checking' });
  const [checkFailed, setCheckFailed] = createSignal(false, { name: 'server-content:check-failed' });
  let disposed = false;
  let checkSequence = 0;
  onCleanup(() => { disposed = true; });
  createEffect(id, () => { checkSequence++; setChecking(false); setCheckFailed(false); }, { name: 'server-content:check-scope' });

  const inventory = () => content.value();
  const gates = createMemo(() => {
    const value = inventory();
    return value ? contentGates(value, props.snapshot) : undefined;
  }, { name: 'server-content:gates' });
  const kinds = createMemo(() => (inventory() ? contentKinds(inventory()!) : []), { name: 'server-content:kinds' });
  const activeFilter = (): ContentFilter => (filter() === 'all' || kinds().includes(filter() as never) ? filter() : 'all');

  // Provider names, icons and version lists: cached and shared with Browse. Listing itself does no provider IO.
  createEffect(inventory, (value) => {
    if (!value) return;
    for (const [provider, ids] of providerLookups(value.items)) void loadProjects(provider, ids).catch(() => {});
  }, { name: 'server-content:providers' });
  const checkUpdates = async () => {
    if (untrack(checking)) return;
    const serverId = id();
    const request = ++checkSequence;
    setChecking(true); setCheckFailed(false);
    const result = await loadVersionLists((inventory()?.items ?? []).flatMap(item => item.provider ? [item.provider] : []),
      () => !disposed && request === checkSequence && serverId === untrack(id));
    if (!disposed && request === checkSequence && serverId === untrack(id)) { setChecking(false); setCheckFailed(result.failed > 0); }
  };

  const projectOf = (entry: ServerContentEntry) => (entry.provider ? peekProject(entry.provider.provider, entry.provider.projectId) : undefined);
  const versionsOf = (entry: ServerContentEntry) => (entry.provider ? peekVersions(entry.provider.provider, entry.provider.projectId) : undefined);
  const updateOf = (entry: ServerContentEntry): ResourceVersion | undefined => {
    const value = inventory();
    return value ? contentUpdate(entry, versionsOf(entry), value) : undefined;
  };

  type ListRow = Exclude<ContentListRow, {kind: 'group'}> | {id:string;kind:'group';group:ServerContentEntry['kind']|'pack'|'own';count:number};
  const listed = createMemo<ContentListRow[]>(() => contentList(inventory()?.items ?? [], {
    filter: activeFilter(),
    query: query(),
    project: projectOf,
    version: (entry) => versionsOf(entry)?.find((version) => version.id === entry.provider?.versionId),
  }), { name: 'server-content:rows' });
  const rows = createMemo<ListRow[]>(() => {
    const entries = listed().filter((r): r is Extract<ContentListRow,{kind:'entry'}> => r.kind === 'entry');
    const bundled = entries.filter(r => isModpackOwned(r.row.entry, owned()));
    if (!bundled.length) return listed();
    const own = entries.filter(r => !isModpackOwned(r.row.entry, owned()));
    return [{id:'group:pack',kind:'group',group:'pack',count:bundled.length},
      ...(expanded() ? bundled : []),
      ...(own.length ? [{id:'group:own',kind:'group' as const,group:'own' as const,count:own.length},...own] : [])];
  }, {name:'server-content:grouped'});
  const visibleCount = () => listed().filter((row) => row.kind === 'entry').length;
  const summary = createMemo(() => ({...pendingSummary(inventory()?.items ?? [], props.snapshot), count: inventory()?.deferredWrites ?? 0, running: !!inventory()?.needsRestart}), { name: 'server-content:pending' });
  const canRestart = () => lifecycleControls(props.snapshot).restart;

  const filterOptions = createMemo(() => [
    { value: 'all', label: t('server-content.filter-all') },
    ...kinds().map((kind) => ({ value: kind, label: t(groupLabel[kind]) })),
  ], { name: 'server-content:filters' });

  /* ---- Actions ---- */

  // One intent per action and item, so retrying an uncertain outcome reuses it.
  const intents = new Map<string, string>();
  const intentFor = (key: string) => {
    let value = intents.get(key);
    if (!value) { value = newIntentId(); intents.set(key, value); }
    return value;
  };
  const mark = (key: string, on: boolean) => setBusy((current) => {
    const next = new Set(current);
    if (on) next.add(key); else next.delete(key);
    return next;
  });
  const refresh = () => invalidateServerResources(id(), CONTENT_RESOURCES);

  const run = async (row: ContentRowModel, action: string, send: (intentId: string) => Promise<ContentChange | void>, done?: (change: ContentChange | void) => void) => {
    const key = `${action}:${row.key}`;
    if (untrack(busy).has(row.key)) return;
    mark(row.key, true);
    try {
      const change = await send(intentFor(key));
      intents.delete(key);
      done?.(change);
    } catch (reason) {
      const error = reason as ServerCommandError;
      // A definite rejection starts a new intent next time; an uncertain one is retried as is.
      if (error.code !== 'outcome_unknown' && error.code !== 'timeout' && error.code !== 'unreachable') intents.delete(key);
      toast.show({ title: t(contentErrorMessage(error)), tone: 'danger' });
    } finally {
      mark(row.key, false);
      refresh();
    }
  };

  const changed = (change: ContentChange | void, applied: Parameters<typeof t>[0], name: string) => {
    if (change && change.state === 'pending') toast.show({ title: t('server-content.staged-toast', { name }), description: t('server-content.staged-description'), tone: 'neutral' });
    else toast.show({ title: t(applied, { name }), tone: 'success' });
  };

  const toggle = (row: ContentRowModel, enabled: boolean) => {
    const entry = row.entry;
    if (entry.kind === 'datapack') return void run(row, 'datapack', (intentId) => toggleDatapack(entry, enabled, intentId), () =>
      toast.show({ title: t(enabled ? 'server-content.datapack-enabling' : 'server-content.datapack-disabling', { name: row.name }), tone: 'neutral' }));
    const request = mutationRequest(entry, enabled ? 'enable' : 'disable');
    if (!request) return;
    void run(row, request.action, (intentId) => serverCommand((client) => client.contentMutate(id(), request, intentId)),
      (change) => changed(change, enabled ? 'server-content.enabled-toast' : 'server-content.disabled-toast', row.name));
  };

  /** Datapacks toggle through the world: saved state while stopped, a Minecraft command while running. */
  const toggleDatapack = async (entry: ServerContentEntry, enabled: boolean, intentId: string) => {
    const packId = datapackId(entry);
    const generation = props.snapshot.status?.generation ?? null;
    if (untrack(gates)?.running && generation) {
      const operation = await serverCommand((client) => client.worldDatapackToggle(id(), packId, enabled, generation, intentId));
      putOperations(id(), [{ ...operation, intent: operation.intent ?? 'console.command' }]);
      // Minecraft saves the change on its next save; read again a little later.
      setTimeout(refresh, 2_000);
      return;
    }
    const world = await readServerResource(id(), worldResource);
    await serverCommand((client) => client.worldDatapackOffline(id(), packId, enabled, world.revision, intentId));
  };

  const update = (row: ContentRowModel) => {
    const version = updateOf(row.entry);
    const request = version ? updateRequest(row.entry, version) : null;
    if (!request || !version) return;
    void run(row, `update:${version.id}`, (intentId) => serverCommand((client) => client.contentInstall(id(), request, intentId)),
      (change) => changed(change, 'server-content.updated-toast', row.name));
  };

  const remove = (row: ContentRowModel) => {
    const request = mutationRequest(row.entry, 'remove');
    if (!request) return;
    void run(row, 'remove', (intentId) => serverCommand((client) => client.contentMutate(id(), request, intentId)),
      (change) => changed(change, 'server-content.removed-toast', row.name));
  };

  const cancel = (row: ContentRowModel) => {
    const pendingId = row.entry.pendingId;
    if (!pendingId) return;
    void run(row, `cancel:${pendingId}`, (intentId) => serverCommand((client) => client.contentCancel(id(), pendingId, intentId)),
      () => toast.show({ title: t('server-content.cancelled-toast', { name: row.name }), tone: 'neutral' }));
  };

  const identify = (row: ContentRowModel) => {
    void run(row, 'identify', async (intentId) => {
      const found = await serverCommand((client) => client.contentIdentify(id(), row.entry.path, intentId));
      // A miss is quiet: the row simply stays unidentified.
      toast.show({ title: t(found ? 'server-content.identified-toast' : 'server-content.identify-none', { name: row.name }), tone: 'neutral' });
    });
  };

  const addContent = () => {
    const value = untrack(inventory);
    const current = untrack(activeFilter);
    browseForServer({
      id: id(),
      name: props.snapshot.connection.name,
      type: current === 'all' ? (value ? primaryKind(value) : 'datapack') : current,
      minecraftVersion: value?.minecraftVersion ?? props.snapshot.info?.minecraftVersion ?? null,
      loader: value?.software ?? null,
    });
  };

  /* ---- Rows ---- */

  const providerBadge = (row: ContentRowModel) => (
    <Show when={row.entry.provider} fallback={<span data-vesta="server-content-provider" data-unknown="">{t('server-content.unidentified')}</span>}>
      {(provider) => (
        <span data-vesta="server-content-provider" data-provider={provider().provider}>
          <Icon name={sourceById(provider().provider).icon} size={11} />
          {sourceById(provider().provider).label}
        </span>
      )}
    </Show>
  );

  const entryRow = (row: () => ContentRowModel) => {
    const entry = () => row().entry;
    const project = () => projectOf(entry());
    const available = () => updateOf(entry());
    const managed = () => isModpackOwned(entry(), owned());
    const actions = () => rowActions(entry(), gates()!, !!available(), managed());
    const working = () => busy().has(row().key);
    const link = () => {
      const provider = entry().provider;
      return provider && project() ? projectPath(provider.provider, provider.projectId) : undefined;
    };
    return (
      <div data-vesta="table-row" role="presentation" class={{ 'resource-row': true, 'row-disabled': entry().enabled === false || entry().pending === 'remove' }}
        data-pending={entry().pending ?? undefined}>
        <div data-vesta="table-cell" role="cell" class="col-name">
          <a data-vesta="resource-identity" href={link() ? `#${link()}` : undefined}
            onPointerEnter={() => { const provider = entry().provider; if (provider) prefetchProject(provider.provider, provider.projectId); }}
            onFocusIn={() => { const provider = entry().provider; if (provider) prefetchProject(provider.provider, provider.projectId); }}
            onClick={(event) => {
              const path = link();
              if (!path || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate(path);
            }}>
            <Show when={project()?.icon_url} fallback={
              <span data-vesta="server-content-placeholder" data-kind={entry().kind} aria-hidden="true"><Icon name={kindIcon[entry().kind]} size={14} /></span>
            }>
              {(src) => <img src={src()} alt="" loading="lazy" decoding="async" width={28} height={28} draggable="false" />}
            </Show>
            <span data-vesta="resource-copy">
              <span data-vesta="resource-title">{row().name}</span>
              <span data-vesta="resource-sub">
                {providerBadge(row())}
                <span data-vesta="resource-file" title={entry().path}>{entry().filename}</span>
                <Show when={entry().pendingError}><span data-tone="danger">{t('server-content.pending-failed')}</span></Show>
              </span>
            </span>
          </a>
        </div>
        <div data-vesta="table-cell" role="cell" class="col-version">
          <span data-vesta="resource-version">
            <span title={row().version ?? undefined}>{row().version ?? t('server-content.version-unknown')}</span>
            <Show when={actions().update ? available() : undefined}>
              {(version) => (
                <IconButton size="sm" variant="ghost" class="resource-update" disabled={working()}
                  label={t('common.update-to', { version: version().version_number })}
                  icon={<Icon name="icons/actions/download" />} onClick={() => update(row())} />
              )}
            </Show>
          </span>
        </div>
        <div data-vesta="table-cell" role="cell" class="col-enabled">
          <Show when={entry().enabled !== null}>
            <Switch size="sm" aria-label={t('server-content.enable', { name: row().name })}
              disabled={working() || !actions().toggle} checked={!!entry().enabled} onChange={(on) => toggle(row(), on)} />
          </Show>
        </div>
        <div data-vesta="table-cell" role="cell" class="col-menu">
          <Show when={menuKey() === row().key} fallback={
            <IconButton variant="ghost" size="sm" tooltip={false} label={t('server-content.actions', { name: row().name })}
              icon={<Icon name="icons/content/ellipsis-v" />} aria-haspopup="menu" onClick={() => setMenuKey(row().key)} />
          }>
            <Menu defaultOpen placement="bottom-end"
              onOpenChange={(open) => {
                if (open) return;
                // Let Kobalte restore focus before replacing its trigger.
                requestAnimationFrame(() => {
                  const cell = document.activeElement?.closest('[data-vesta="table-cell"]');
                  setMenuKey(null);
                  queueMicrotask(() => cell?.querySelector('button')?.focus({ preventScroll: true }));
                });
              }}
              trigger={(menuProps) => (
                <IconButton {...menuProps} variant="ghost" size="sm" tooltip={false} label={t('server-content.actions', { name: row().name })}
                  icon={<Icon name="icons/content/ellipsis-v" />} />
              )}>
              <Show when={actions().update ? available() : undefined}>
                {(version) => (
                  <MenuItem icon={<Icon name="icons/actions/download" />} disabled={working()} onSelect={() => update(row())}>
                    {t('common.update-to', { version: version().version_number })}
                  </MenuItem>
                )}
              </Show>
              <Show when={actions().identify}>
                <MenuItem icon={<Icon name="icons/content/search" />} disabled={working()} onSelect={() => identify(row())}>{t('server-content.identify')}</MenuItem>
              </Show>
              <Show when={actions().cancel}>
                <MenuItem icon={<Icon name="icons/actions/close" />} disabled={working()} onSelect={() => cancel(row())}>{t('server-content.cancel')}</MenuItem>
              </Show>
              <MenuItem icon={<Icon name="icons/content/folder" />}
                onSelect={() => navigate(`/servers/${id()}/files/${entry().path.split('/').slice(0, -1).map(encodeURIComponent).join('/')}`)}>
                {t('server-content.show-in-files')}
              </MenuItem>
              <MenuSeparator />
              <Show when={actions().managed} fallback={
                <MenuItem tone="danger" icon={<Icon name="icons/actions/delete" />} disabled={working() || !actions().remove}
                  onSelect={() => { if (actions().remove) remove(row()); }}>
                  {t('server-content.remove')}
                </MenuItem>
              }>
                <MenuItem icon={<Icon name="icons/security/lock" />} disabled>{t('server-content.managed-by-modpack')}</MenuItem>
                <MenuItem icon={<Icon name="icons/content/modpack" />} onSelect={() => navigate(serverModpackPath(id()))}>{t('server-content.open-modpack')}</MenuItem>
              </Show>
            </Menu>
          </Show>
        </div>
      </div>
    );
  };

  const groupRow = (row: () => Extract<ListRow, { kind: 'group' }>) => (
    <div data-vesta="table-row" role="presentation" class={{'resource-group-row':true,'resource-pack-row':row().group === 'pack'}}>
      <div data-vesta="table-cell" role="cell" aria-colspan={4}>
        <Show when={row().group === 'pack'} fallback={
          <div data-vesta="resource-group">
            <Icon name={row().group === 'own' ? 'icons/content/layers' : kindIcon[row().group as ServerContentEntry['kind']]} size={14} />
            <strong>{row().group === 'own' ? t('resources.added-by-you') : t(groupLabel[row().group as ServerContentEntry['kind']])}</strong>
            <span data-vesta="resource-group-count">{row().count}</span>
          </div>
        }>
          <button type="button" data-vesta="resource-group" aria-expanded={expanded() ? 'true' : 'false'} onClick={() => setExpanded(!expanded())}>
            <Icon name="icons/controls/chevron-down" size={12} class="resource-group-chevron" />
            <Show when={(() => { const source = linkProvider(modpackSource()); return source ? peekProject(source.provider, source.projectId)?.icon_url : null; })()}>
              {(icon) => <img src={icon()} alt="" loading="lazy" decoding="async" width={32} height={32} />}
            </Show>
            <strong>{modpackName()}</strong>
            <span data-vesta="resource-group-meta">{t('resources.modpack-group', {version:pack.value()?.serverModpack?.displayVersion ?? ''})}</span>
            <span data-vesta="resource-group-count">{row().count}</span>
          </button>
        </Show>
      </div>
    </div>
  );

  return (
    <div data-vesta="resources" data-server-content="">
      <div data-vesta="resources-toolbar">
        <div data-vesta="resources-tools" class="resources-bar">
          <Show when={kinds().length > 1}>
            <SegmentedControl size="sm" aria-label={t('server-content.filter-label')} options={filterOptions()}
              value={activeFilter()} onChange={(value) => setFilter(value as ContentFilter)} />
          </Show>
          <TextField size="sm" class="resources-search" aria-label={t('server-content.search')} placeholder={t('server-content.search')}
            icon={<Icon name="icons/content/search" size={14} />} value={query()} onChange={setQuery} />
          <Show when={inventory()?.capabilities.update && inventory()?.items.some(item => !!item.provider)}>
            <Button size="sm" variant="outline" disabled={checking()} onClick={() => void checkUpdates()}>
              {t(checking() ? 'server-pack.checking-content' : 'server-pack.check-content')}
            </Button>
          </Show>
          <Show when={gates()?.install}>
            <Button size="sm" tone="accent" icon={<Icon name="icons/actions/add" />} onClick={addContent}>{t('server-content.add')}</Button>
          </Show>
        </div>
      </div>

      <Show when={summary().running && summary().count}>
        <div data-vesta="server-content-summary" data-tone={summary().failed ? 'danger' : 'accent'} role="status">
          <Icon name={summary().failed ? 'icons/controls/warning' : 'icons/actions/reload'} size={15} />
          <span data-vesta="server-content-summary-text">
            <strong>{t('server-content.restart-load', { count: summary().count })}</strong>
          </span>
          <Show when={summary().running && canRestart()}>
            <Button size="sm" variant="outline" icon={<Icon name="icons/actions/reload" />}
              disabled={!!lifecycle.busy() || lifecycle.pending('restart')} onClick={() => void lifecycle.submit('restart')}>
              {t('server-content.restart-to-apply')}
            </Button>
          </Show>
        </div>
      </Show>

      <ServerErrorNote error={content.error()} onRetry={() => void content.refresh()} />
      <Show when={checkFailed()}><p data-vesta="server-callout" data-tone="warning" role="alert">{t('server-pack.check-content-failed')}</p></Show>
      <span data-vesta="sr-only" role="status">{checking() ? t('server-pack.checking-content') : ''}</span>
      <Show when={inventory()?.truncated}>
        <p data-vesta="server-callout" data-tone="warning" class="server-content-note">{t('server-content.truncated')}</p>
      </Show>
      <Show when={inventory() && !inventory()!.software && !inventory()!.capabilities.modsSupported && !inventory()!.capabilities.pluginsSupported}>
        <p data-vesta="server-callout" data-tone="neutral" class="server-content-note">{t('server-content.software-unknown')}</p>
      </Show>

      <div data-vesta="resources-list" tabindex={0} ref={setViewport}>
        <Show when={inventory()} fallback={
          <Show when={!content.error()}><EmptyState variant="inline" icon="icons/content/layers" title={t('server-content.loading')} /></Show>
        }>
          {(value) => (
            <Show when={visibleCount()} fallback={<ContentEmpty inventory={value()} query={query()} onClear={() => setQuery('')} />}>
              <div data-vesta="table-scroll" class="resource-table server-content-table">
                <div data-vesta="table" role="table" aria-label={t('server-content.tab')} aria-colcount={4} aria-rowcount={rows().length + 1}>
                  <VirtualList
                    items={rows()}
                    key={(row) => row.id}
                    rowHeight={44}
                    getHeight={(index) => { const row = rows()[index]; return row?.kind === 'group' ? row.group === 'pack' ? 52 : 36 : 44; }}
                    scrollElement={viewport()}
                    pinnedKey={menuKey() ? `entry:${menuKey()}` : null}
                    rowRole="row"
                    headerHeight={32}
                    headerHook="table-header"
                    bodyHook="table-body"
                    header={
                      <div data-vesta="table-row" role="row" aria-rowindex={1}>
                        <div data-vesta="table-head" role="columnheader" class="col-name">{t('resources.name-column')}</div>
                        <div data-vesta="table-head" role="columnheader" class="col-version">{t('resources.version-column')}</div>
                        <div data-vesta="table-head" role="columnheader" class="col-enabled">{t('resources.enabled-column')}</div>
                        <div data-vesta="table-head" role="columnheader" class="col-menu"><span data-vesta="sr-only">{t('resources.actions-column')}</span></div>
                      </div>
                    }
                  >
                    {(item) => (
                      <Show when={item().kind === 'entry'} fallback={groupRow(() => item() as Extract<ListRow, { kind: 'group' }>)}>
                        {entryRow(() => (item() as Extract<ContentListRow, { kind: 'entry' }>).row)}
                      </Show>
                    )}
                  </VirtualList>
                </div>
              </div>
            </Show>
          )}
        </Show>
      </div>


    </div>
  );
}

function ContentEmpty(props: { inventory: ServerContentInventory; query: string; onClear: () => void }) {
  return (
    <EmptyState
      variant="inline"
      icon="icons/content/layers"
      title={t(props.query ? 'resources.no-matches' : 'server-content.empty')}
      description={props.query ? t('resources.try-another-search') : t('server-content.empty-hint', { type: t(kindLabel[primaryKind(props.inventory)]).toLowerCase() })}
    >
      <Show when={props.query}>
        <Button size="sm" variant="outline" onClick={props.onClear}>{t('common.clear-search')}</Button>
      </Show>
    </EmptyState>
  );
}
