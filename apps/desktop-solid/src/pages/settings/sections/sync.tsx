import { Badge, Button, Checkbox, IconButton, SegmentedControl, Select, Skeleton, Switch, TextField } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { For, Show, createMemo, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { VirtualList } from '../../../components/virtual-list';
import { instances } from '../../../features/instances/catalog';
import {
  addSyncedServer,
  linkAllInstances,
  removeSyncedServer,
  retrySync,
  saveSyncValue,
  setSyncSelection,
  setSyncState,
  syncCategories,
  syncError,
  syncLoading,
  syncPending,
  syncState,
  syncValueItems,
  toggleInstanceLink,
  type SyncCategoryId,
} from '../../../features/settings/sync';
import { formatOptionName, type SyncItem } from '../../../features/settings/sync-model';
import { SyncSourceDialog } from '../../../features/settings/sync-source-dialog';
import { t } from '../../../localization';
import { Callout } from '../parts';
import { SyncValueControl } from './sync-value';
import './sync.css';

const ALL = '@all';
const ROW = 40;
const hasValues = (id: SyncCategoryId) => id === 'options' || id === 'keybinds';

/** Share game options, keybinds and servers using the host revisioned bundles. */
export function SyncSettings() {
  const [open, setOpen] = createSignal<SyncCategoryId>();
  return (
    <>
      <SyncSourceDialog />
      <Show when={syncError()}>
        {(message) => (
          <div data-vesta="prefs-sync-error">
            <Callout tone="danger">{message()}</Callout>
            <Button size="sm" variant="outline" onClick={() => void retrySync()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </Show>
      <Show when={!syncLoading()} fallback={<Loading />}>
        <Show when={open()} fallback={<Overview onOpen={setOpen} />} keyed>
          {(id) => <Detail id={id} onBack={() => setOpen(undefined)} />}
        </Show>
      </Show>
    </>
  );
}

function Loading() {
  return (
    <div data-vesta="prefs-sync-loading" role="status" aria-label={t('prefs.sync.loading')}>
      <Skeleton height={56} />
      <Skeleton height={56} />
      <Skeleton height={56} />
    </div>
  );
}

const sourceName = (source: string | null | undefined) =>
  instances().find((entry) => entry.instance.id === source)?.instance.name;

/** Counts of synced values; a missing selection means everything the source holds. */
function valueCounts(id: SyncCategoryId) {
  const items = syncValueItems(id);
  const selected = new Set(syncState()[id].selected);
  return { total: items.length, selected: items.filter((item) => item.fixed || selected.has(item.key)).length };
}

function Overview(props: { onOpen: (id: SyncCategoryId) => void }) {
  return (
    <>
      <p data-vesta="prefs-lede">{t('prefs.sync.lede')}</p>
      <Show
        when={instances().length}
        fallback={
          <div data-vesta="prefs-sync-empty">
            <strong>{t('prefs.sync.empty-title')}</strong>
            <span>{t('prefs.sync.empty-description')}</span>
          </div>
        }
      >
        <ul data-vesta="prefs-sync-cards">
          <For each={syncCategories}>
            {(category) => {
              const state = () => syncState()[category.id];
              const counts = () => valueCounts(category.id);
              const source = () => sourceName(state().source);
              const pending = () => syncPending(category.id).length;
              const live = () => !category.disabled && state().enabled;
              return (
                <li data-disabled={category.disabled ? '' : undefined} data-on={live() ? '' : undefined}>
                  <span data-vesta="prefs-sync-icon">
                    <Icon name={category.icon} size={18} />
                  </span>
                  <div data-vesta="prefs-sync-summary">
                    <strong>{t(category.label)}</strong>
                    <span>
                      <Show
                        when={live()}
                        fallback={category.disabled ? t('prefs.coming-soon') : t(category.description)}
                      >
                        {hasValues(category.id)
                          ? source()
                            ? t('prefs.sync.summary-source', { name: source()! })
                            : t('prefs.sync.no-source')
                          : t('prefs.sync.summary-servers', { count: state().servers.length })}
                        {' · '}
                        {t('prefs.sync.summary-instances', { count: state().linked.length })}
                        <Show when={hasValues(category.id) && counts().total > 0}>
                          {' · '}
                          {t('prefs.sync.summary-values', { count: counts().selected, max: counts().total })}
                        </Show>
                      </Show>
                    </span>
                    <Show when={live() && pending() > 0}>
                      <small>{t('prefs.sync.pending', { count: pending() })}</small>
                    </Show>
                  </div>
                  <Show when={live()}>
                    <Button size="sm" variant="ghost" onClick={() => props.onOpen(category.id)}>
                      {t('prefs.sync.manage')}
                    </Button>
                  </Show>
                  <Switch
                    size="sm"
                    aria-label={t(category.label)}
                    disabled={category.disabled}
                    checked={state().enabled}
                    onChange={(enabled) => setSyncState(category.id, { enabled })}
                  />
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </>
  );
}

/** A bounded scroll pane whose rows are windowed, so lists of any length stay cheap. */
function Checklist<T>(props: {
  items: readonly T[];
  key: (item: T) => string;
  empty: string;
  children: (item: () => T) => JSX.Element;
}) {
  const [scroller, setScroller] = createSignal<HTMLElement | undefined>(undefined, { name: 'syncChecklistScroller' });
  return (
    <div data-vesta="prefs-sync-list" ref={setScroller}>
      <Show when={props.items.length} fallback={<p data-vesta="prefs-sync-none">{props.empty}</p>}>
        <VirtualList items={props.items} key={props.key} rowHeight={ROW} scrollElement={scroller()}>
          {(item) => props.children(item)}
        </VirtualList>
      </Show>
    </div>
  );
}

const groupIcons: Record<string, string> = {
  video: 'icons/content/monitor',
  sound: 'icons/content/sliders',
  language: 'icons/content/globe',
  chat: 'icons/content/chat',
  multiplayer: 'icons/content/chat',
  controls: 'icons/content/keyboard',
  mouse: 'icons/content/keyboard',
  movement: 'icons/content/keyboard',
  gameplay: 'icons/content/cube',
  inventory: 'icons/content/grid',
  accessibility: 'icons/content/accessibility',
  skin: 'icons/content/skin-icon',
  online: 'icons/status/wifi',
  custom: 'icons/content/code',
};
const groupIcon = (group: string) => groupIcons[group] ?? 'icons/content/layers';
const groupLabel = (group: string) =>
  group === ALL
    ? t('prefs.sync.all-values')
    : group === 'custom'
      ? t('prefs.sync.group-custom')
      : formatOptionName(group);

function Detail(props: { id: SyncCategoryId; onBack: () => void }) {
  // The page is keyed by category, so the id never changes while this component lives.
  const id = untrack(() => props.id);
  const category = syncCategories.find((item) => item.id === id)!;
  const primary = hasValues(id) ? 'values' : 'servers';
  const [view, setView] = createSignal<string>(primary, { name: 'syncDetailView' });
  const state = () => syncState()[id];
  const source = () => sourceName(state().source);

  return (
    <div data-vesta="prefs-sync-detail" data-off={state().enabled ? undefined : ''}>
      <header data-vesta="prefs-subhead">
        <IconButton
          size="sm"
          variant="ghost"
          label={t('common.back')}
          icon={<Icon name="icons/navigation/arrow-back" />}
          onClick={props.onBack}
        />
        <div>
          <h3>{t(category.label)}</h3>
          <span>
            <Show when={hasValues(id) && source()} fallback={t(category.description)}>
              {(name) => t('prefs.sync.summary-source', { name: name() })}
            </Show>
          </span>
        </div>
        <SegmentedControl
          size="sm"
          aria-label={t('prefs.sync.sections')}
          value={view()}
          onChange={setView}
          options={[
            {
              value: primary,
              label: hasValues(id) ? t('prefs.sync.tab-values') : t('prefs.sync.servers-shared'),
            },
            { value: 'instances', label: t('prefs.sync.instances') },
          ]}
        />
        <Switch
          size="sm"
          aria-label={t(category.label)}
          checked={state().enabled}
          onChange={(enabled) => setSyncState(id, { enabled })}
        />
      </header>
      <Show when={!state().enabled}>
        <p data-vesta="prefs-lede">{t('prefs.sync.disabled-hint')}</p>
      </Show>
      <div data-vesta="prefs-sync-body">
        <Show when={view() === 'instances'}>
          <InstancePane id={id} />
        </Show>
        <Show when={view() === 'servers'}>
          <ServerPane />
        </Show>
        <Show when={view() === 'values'}>
          <ValuePane id={id} />
        </Show>
      </div>
    </div>
  );
}

type ValueRow = { type: 'group'; group: string; members: SyncItem[] } | { type: 'item'; item: SyncItem };

function ValuePane(props: { id: SyncCategoryId }) {
  const id = untrack(() => props.id);
  const [search, setSearch] = createSignal('', { name: 'syncValueSearch' });
  const [scope, setScope] = createSignal(ALL, { name: 'syncValueScope' });
  const items = createMemo(() => syncValueItems(id));
  const selected = createMemo(() => new Set(syncState()[id].selected));
  const isOn = (item: SyncItem) => item.fixed || selected().has(item.key);
  const groups = createMemo(() => {
    const map = new Map<string, SyncItem[]>();
    for (const item of items()) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    return [...map.entries()]
      .sort(([a], [b]) => (a === 'custom' ? 1 : b === 'custom' ? -1 : groupLabel(a).localeCompare(groupLabel(b))))
      .map(([group, members]) => ({ group, members }));
  });
  const tally = (members: SyncItem[]) => {
    const on = members.filter(isOn).length;
    return { on, all: members.length > 0 && on === members.length, some: on > 0 && on < members.length };
  };
  const setShared = (members: SyncItem[], on: boolean) =>
    setSyncSelection(
      id,
      members.filter((item) => !item.fixed).map((item) => item.key),
      on,
    );

  // Filtered groups flatten into header and item rows, so one windowed list shows both.
  const visible = createMemo(() => {
    const needle = search().trim().toLowerCase();
    return groups()
      .filter((entry) => scope() === ALL || entry.group === scope())
      .map((entry) => ({
        ...entry,
        members: entry.members.filter((item) => !needle || `${item.label} ${item.key}`.toLowerCase().includes(needle)),
      }))
      .filter((entry) => entry.members.length);
  });
  const rows = createMemo<ValueRow[]>(() =>
    visible().flatMap((entry) => [
      { type: 'group' as const, group: entry.group, members: entry.members },
      ...entry.members.map((item) => ({ type: 'item' as const, item })),
    ]),
  );
  const shown = createMemo(() => visible().flatMap((entry) => entry.members));
  const shownAll = () => tally(shown()).all;

  const scopes = createMemo(() => [
    { value: ALL, label: `${groupLabel(ALL)} (${tally(items()).on}/${items().length})` },
    ...groups().map((entry) => ({
      value: entry.group,
      label: `${groupLabel(entry.group)} (${tally(entry.members).on}/${entry.members.length})`,
    })),
  ]);

  return (
    <>
      <div data-vesta="prefs-sync-toolbar">
        <TextField
          size="sm"
          icon={<Icon name="icons/content/search" size={14} />}
          aria-label={t('prefs.sync.search-values')}
          placeholder={t('prefs.sync.search-values')}
          value={search()}
          onChange={setSearch}
        />
        <Select
          size="sm"
          aria-label={t('prefs.sync.sections')}
          options={scopes()}
          value={scope()}
          onChange={setScope}
        />
        <Button size="sm" variant="outline" disabled={!shown().length} onClick={() => setShared(shown(), !shownAll())}>
          {shownAll() ? t('prefs.sync.share-none') : t('prefs.sync.share-all')}
        </Button>
      </div>
      <Checklist
        items={rows()}
        key={(row) => (row.type === 'group' ? `group:${row.group}` : row.item.key)}
        empty={items().length ? t('prefs.sync.no-values') : t('prefs.sync.nothing-to-share')}
      >
        {(row) => {
          // Keys are prefixed by row type, so a mounted row never changes type; its data still can.
          if (untrack(row).type === 'group') {
            const group = () => row() as Extract<ValueRow, { type: 'group' }>;
            const count = () => tally(group().members);
            return (
              <div data-vesta="prefs-sync-group">
                <Checkbox
                  size="sm"
                  aria-label={t('prefs.sync.share-group', { name: groupLabel(group().group) })}
                  checked={count().all}
                  indeterminate={count().some}
                  onChange={() => setShared(group().members, !count().all)}
                />
                <Icon name={groupIcon(group().group)} size={14} />
                <strong>{groupLabel(group().group)}</strong>
                <small>{t('prefs.sync.group-count', { count: count().on, max: group().members.length })}</small>
              </div>
            );
          }
          const item = () => (row() as Extract<ValueRow, { type: 'item' }>).item;
          return (
            <div data-vesta="prefs-sync-row" data-off={isOn(item()) ? undefined : ''}>
              <Checkbox
                size="sm"
                aria-label={t('prefs.sync.share-value', { name: item().label })}
                checked={isOn(item())}
                disabled={item().fixed}
                onChange={(on) => setSyncSelection(id, [item().key], on)}
              />
              <span data-vesta="prefs-sync-label" title={item().fixed ? t('prefs.sync.fixed') : item().key}>
                {item().label}
              </span>
              <SyncValueControl
                item={item()}
                disabled={!isOn(item())}
                onSave={(value) => void saveSyncValue(id, item().key, value)}
              />
            </div>
          );
        }}
      </Checklist>
    </>
  );
}

function InstancePane(props: { id: SyncCategoryId }) {
  const id = untrack(() => props.id);
  const [search, setSearch] = createSignal('', { name: 'syncInstanceSearch' });
  const state = () => syncState()[id];
  const all = () => instances();
  const shown = createMemo(() => {
    const needle = search().trim().toLowerCase();
    return all().filter((entry) => !needle || entry.instance.name.toLowerCase().includes(needle));
  });
  const linkedAll = () => all().length > 0 && all().every((entry) => state().linked.includes(entry.instance.id));
  return (
    <>
      <div data-vesta="prefs-sync-toolbar">
        <TextField
          size="sm"
          icon={<Icon name="icons/content/search" size={14} />}
          aria-label={t('common.search')}
          placeholder={t('common.search')}
          value={search()}
          onChange={setSearch}
        />
        <span data-vesta="prefs-sync-count">
          {t('prefs.sync.instances-count', { count: state().linked.length, max: all().length })}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            linkAllInstances(
              id,
              !linkedAll(),
              all().map((entry) => entry.instance.id),
            )
          }
        >
          {linkedAll() ? t('prefs.sync.unlink-all') : t('prefs.sync.link-all')}
        </Button>
      </div>
      <Checklist items={shown()} key={(entry) => entry.instance.id} empty={t('prefs.sync.no-instances')}>
        {(entry) => {
          const isSource = () => state().source === entry().instance.id;
          const linked = () => state().linked.includes(entry().instance.id);
          return (
            <div data-vesta="prefs-sync-row" data-off={linked() ? undefined : ''}>
              <Checkbox
                size="sm"
                aria-label={entry().instance.name}
                checked={linked()}
                disabled={isSource()}
                onChange={(on) => toggleInstanceLink(id, entry().instance.id, on)}
              />
              <img src={entry().instance.image} alt="" draggable="false" />
              <span data-vesta="prefs-sync-label">{entry().instance.name}</span>
              <span data-vesta="prefs-sync-meta">{entry().instance.minecraftVersion}</span>
              <Show when={isSource()}>
                <Badge size="sm" tone="accent">
                  {t('prefs.sync.source-badge')}
                </Badge>
              </Show>
            </div>
          );
        }}
      </Checklist>
    </>
  );
}

function ServerPane() {
  const [name, setName] = createSignal('', { name: 'syncServerName' });
  const [address, setAddress] = createSignal('', { name: 'syncServerAddress' });
  const servers = () => syncState().servers.servers;
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    if (!name().trim() || !address().trim()) return;
    void addSyncedServer(name().trim(), address().trim());
    setName('');
    setAddress('');
  };
  return (
    <>
      <form data-vesta="prefs-sync-toolbar" onSubmit={add}>
        <TextField
          size="sm"
          aria-label={t('prefs.sync.server-name')}
          placeholder={t('prefs.sync.server-name')}
          value={name()}
          onChange={setName}
        />
        <TextField
          size="sm"
          aria-label={t('prefs.sync.server-address')}
          placeholder="play.example.net"
          value={address()}
          onChange={setAddress}
        />
        <Button
          size="sm"
          type="submit"
          tone="accent"
          disabled={!name().trim() || !address().trim()}
          icon={<Icon name="icons/actions/add" size={14} />}
        >
          {t('common.add')}
        </Button>
      </form>
      <Checklist items={servers()} key={(server) => server.id} empty={t('prefs.sync.no-servers')}>
        {(server) => (
          <div data-vesta="prefs-sync-row">
            <Icon name="icons/content/server" size={16} />
            <span data-vesta="prefs-sync-label">{server().name}</span>
            <span data-vesta="prefs-sync-meta">{server().address}</span>
            <IconButton
              size="sm"
              variant="ghost"
              tone="danger"
              label={t('prefs.sync.remove-server', { name: server().name })}
              icon={<Icon name="icons/actions/delete" size={14} />}
              onClick={() => void removeSyncedServer(server().id)}
            />
          </div>
        )}
      </Checklist>
    </>
  );
}
