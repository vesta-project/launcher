import { Badge, Button, Checkbox, IconButton, Skeleton, Switch, TextField } from '@vesta/ui';
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
import './sync.css';

const ALL = '@all';
const INSTANCES = '@instances';
const SERVERS = '@servers';
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
      <Skeleton height={64} />
      <Skeleton height={64} />
      <Skeleton height={64} />
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
              return (
                <li data-disabled={category.disabled ? '' : undefined} data-on={state().enabled ? '' : undefined}>
                  <span data-vesta="prefs-sync-icon">
                    <Icon name={category.icon} size={20} />
                  </span>
                  <div data-vesta="prefs-sync-summary">
                    <strong>{t(category.label)}</strong>
                    <Show
                      when={!category.disabled && state().enabled}
                      fallback={<span>{category.disabled ? t('prefs.coming-soon') : t(category.description)}</span>}
                    >
                      <span>
                        {hasValues(category.id)
                          ? source()
                            ? t('prefs.sync.summary-source', { name: source()! })
                            : t('prefs.sync.no-source')
                          : t('prefs.sync.summary-servers', { count: state().servers.length })}
                        {' · '}
                        {t('prefs.sync.summary-instances', { count: state().linked.length })}
                      </span>
                      <Show when={hasValues(category.id) && counts().total > 0}>
                        <small>
                          {t('prefs.sync.summary-values', { count: counts().selected, max: counts().total })}
                        </small>
                      </Show>
                      <Show when={pending() > 0}>
                        <small>{t('prefs.sync.pending', { count: pending() })}</small>
                      </Show>
                    </Show>
                  </div>
                  <Switch
                    size="sm"
                    aria-label={t(category.label)}
                    disabled={category.disabled}
                    checked={state().enabled}
                    onChange={(enabled) => setSyncState(category.id, { enabled })}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={category.disabled || !state().enabled}
                    onClick={() => props.onOpen(category.id)}
                  >
                    {t('prefs.sync.manage')}
                  </Button>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </>
  );
}

/** A fixed-height scroll pane whose rows are windowed, so lists of any length stay cheap. */
function Checklist<T>(props: {
  items: readonly T[];
  key: (item: T) => string;
  empty: string;
  children: (item: () => T) => JSX.Element;
}) {
  const [scroller, setScroller] = createSignal<HTMLElement | undefined>(undefined, { name: 'syncChecklistScroller' });
  return (
    <div data-vesta="prefs-sync-list" ref={setScroller} tabindex={0}>
      <Show when={props.items.length} fallback={<p data-vesta="prefs-empty-line">{props.empty}</p>}>
        <VirtualList items={props.items} key={props.key} rowHeight={40} scrollElement={scroller()}>
          {(item) => props.children(item)}
        </VirtualList>
      </Show>
    </div>
  );
}

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
  const [view, setView] = createSignal(hasValues(id) ? ALL : id === 'servers' ? SERVERS : INSTANCES);
  const state = () => syncState()[id];
  const items = createMemo(() => syncValueItems(id));
  const selected = createMemo(() => new Set(state().selected));
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
    return {
      on,
      total: members.length,
      all: members.length > 0 && on === members.length,
      some: on > 0 && on < members.length,
    };
  };
  const toggleGroup = (members: SyncItem[]) =>
    setSyncSelection(
      id,
      members.filter((item) => !item.fixed).map((item) => item.key),
      !tally(members).all,
    );

  return (
    <>
      <header data-vesta="prefs-subhead">
        <Button size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-back" />} onClick={props.onBack}>
          {t('common.back')}
        </Button>
        <div>
          <h3>{t(category.label)}</h3>
          <Show when={hasValues(id) && sourceName(state().source)}>
            {(name) => <span>{t('prefs.sync.summary-source', { name: name() })}</span>}
          </Show>
        </div>
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
      <div data-vesta="prefs-sync-editor" data-off={state().enabled ? undefined : ''}>
        <nav data-vesta="prefs-sync-sidebar" aria-label={t('prefs.sync.sections')}>
          <Show when={hasValues(id)}>
            <SidebarItem
              label={groupLabel(ALL)}
              count={t('prefs.sync.group-count', { count: tally(items()).on, max: items().length })}
              active={view() === ALL}
              onSelect={() => setView(ALL)}
              check={{ ...tally(items()), toggle: () => toggleGroup(items()) }}
            />
            <For each={groups()}>
              {(entry) => (
                <SidebarItem
                  label={groupLabel(entry.group)}
                  count={t('prefs.sync.group-count', {
                    selected: tally(entry.members).on,
                    total: entry.members.length,
                  })}
                  active={view() === entry.group}
                  onSelect={() => setView(entry.group)}
                  check={{ ...tally(entry.members), toggle: () => toggleGroup(entry.members) }}
                />
              )}
            </For>
          </Show>
          <Show when={id === 'servers'}>
            <SidebarItem
              label={t('prefs.sync.servers-shared')}
              count={String(state().servers.length)}
              active={view() === SERVERS}
              onSelect={() => setView(SERVERS)}
            />
          </Show>
          <SidebarItem
            label={t('prefs.sync.instances')}
            count={t('prefs.sync.instances-count', { count: state().linked.length, max: instances().length })}
            active={view() === INSTANCES}
            onSelect={() => setView(INSTANCES)}
          />
        </nav>
        <div data-vesta="prefs-sync-pane">
          <Show when={view() === INSTANCES}>
            <InstancePane id={id} />
          </Show>
          <Show when={view() === SERVERS}>
            <ServerPane />
          </Show>
          <Show when={view() !== INSTANCES && view() !== SERVERS}>
            <ValuePane
              id={id}
              items={view() === ALL ? items() : (groups().find((entry) => entry.group === view())?.members ?? [])}
              isOn={isOn}
            />
          </Show>
        </div>
      </div>
    </>
  );
}

function SidebarItem(props: {
  label: string;
  count: string;
  active: boolean;
  onSelect: () => void;
  check?: { all: boolean; some: boolean; toggle: () => void };
}) {
  return (
    <div data-vesta="prefs-sync-nav" data-active={props.active ? '' : undefined}>
      <Show when={props.check}>
        {(check) => (
          <Checkbox
            size="sm"
            aria-label={props.label}
            checked={check().all}
            indeterminate={check().some}
            onChange={() => check().toggle()}
          />
        )}
      </Show>
      <button type="button" aria-current={props.active ? 'true' : undefined} onClick={() => props.onSelect()}>
        <span>{props.label}</span>
        <small>{props.count}</small>
      </button>
    </div>
  );
}

function ValuePane(props: { id: SyncCategoryId; items: SyncItem[]; isOn: (item: SyncItem) => boolean }) {
  const [search, setSearch] = createSignal('');
  const shown = createMemo(() => {
    const needle = search().trim().toLowerCase();
    return props.items.filter((item) => !needle || `${item.label} ${item.key}`.toLowerCase().includes(needle));
  });
  const selectable = () =>
    shown()
      .filter((item) => !item.fixed)
      .map((item) => item.key);
  return (
    <>
      <div data-vesta="prefs-sync-toolbar">
        <TextField
          aria-label={t('prefs.sync.search-values')}
          placeholder={t('prefs.sync.search-values')}
          value={search()}
          onChange={setSearch}
        />
        <Button size="sm" variant="outline" onClick={() => setSyncSelection(props.id, selectable(), true)}>
          {t('prefs.sync.select-all')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSyncSelection(props.id, selectable(), false)}>
          {t('prefs.sync.select-none')}
        </Button>
      </div>
      <Checklist
        items={shown()}
        key={(item) => item.key}
        empty={props.items.length ? t('prefs.sync.no-values') : t('prefs.sync.nothing-to-share')}
      >
        {(item) => (
          <div data-vesta="prefs-sync-row" title={item().fixed ? t('prefs.sync.fixed') : item().key}>
            <Checkbox
              size="sm"
              label={item().label}
              checked={props.isOn(item())}
              disabled={item().fixed}
              onChange={(on) => setSyncSelection(props.id, [item().key], on)}
            />
            <input
              data-vesta="prefs-sync-value"
              aria-label={t('prefs.sync.value-label', { name: item().label })}
              value={item().value}
              disabled={!props.isOn(item())}
              onChange={(event) => void saveSyncValue(props.id, item().key, event.currentTarget.value)}
            />
          </div>
        )}
      </Checklist>
    </>
  );
}

function InstancePane(props: { id: SyncCategoryId }) {
  const [search, setSearch] = createSignal('');
  const state = () => syncState()[props.id];
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
          aria-label={t('common.search')}
          placeholder={t('common.search')}
          value={search()}
          onChange={setSearch}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            linkAllInstances(
              props.id,
              !linkedAll(),
              all().map((entry) => entry.instance.id),
            )
          }
        >
          {linkedAll() ? t('prefs.sync.unlink-all') : t('prefs.sync.link-all')}
        </Button>
      </div>
      <Checklist items={shown()} key={(entry) => entry.instance.id} empty={t('prefs.sync.no-instances')}>
        {(entry) => (
          <div data-vesta="prefs-sync-row">
            <Checkbox
              size="sm"
              aria-label={entry().instance.name}
              checked={state().linked.includes(entry().instance.id)}
              disabled={state().source === entry().instance.id}
              onChange={(on) => toggleInstanceLink(props.id, entry().instance.id, on)}
            />
            <img src={entry().instance.image} alt="" draggable="false" />
            <div>
              <strong>{entry().instance.name}</strong>
              <span>{entry().instance.minecraftVersion}</span>
            </div>
            <Show when={state().source === entry().instance.id}>
              <Badge size="sm">{t('prefs.sync.source-badge')}</Badge>
            </Show>
          </div>
        )}
      </Checklist>
    </>
  );
}

function ServerPane() {
  const [name, setName] = createSignal('');
  const [address, setAddress] = createSignal('');
  const servers = () => syncState().servers.servers;
  return (
    <>
      <Checklist items={servers()} key={(server) => server.id} empty={t('prefs.sync.no-servers')}>
        {(server) => (
          <div data-vesta="prefs-sync-row">
            <span data-vesta="prefs-sync-icon">
              <Icon name="icons/content/server" size={16} />
            </span>
            <div>
              <strong>{server().name}</strong>
              <span>{server().address}</span>
            </div>
            <IconButton
              size="sm"
              variant="ghost"
              tone="danger"
              label={t('prefs.sync.remove-server', { name: server().name })}
              icon={<Icon name="icons/actions/delete" />}
              onClick={() => void removeSyncedServer(server().id)}
            />
          </div>
        )}
      </Checklist>
      <div data-vesta="prefs-add-feed">
        <TextField
          aria-label={t('prefs.sync.server-name')}
          placeholder={t('prefs.sync.server-name')}
          value={name()}
          onChange={setName}
        />
        <TextField
          aria-label={t('prefs.sync.server-address')}
          placeholder="play.example.net"
          value={address()}
          onChange={setAddress}
        />
        <Button
          tone="accent"
          disabled={!name().trim() || !address().trim()}
          icon={<Icon name="icons/actions/add" size={14} />}
          onClick={() => {
            void addSyncedServer(name().trim(), address().trim());
            setName('');
            setAddress('');
          }}
        >
          {t('common.add')}
        </Button>
      </div>
    </>
  );
}
