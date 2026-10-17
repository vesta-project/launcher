import { Button, Dialog, IconButton, Switch, TextField } from '@vesta/ui';
import { For, Show, createMemo, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { instances } from '../../../features/instances/catalog';
import {
  availableSyncOptions,
  syncError,
  addSyncedServer,
  removeSyncedServer,
  syncCategories,
  syncState,
  setSyncState,
  toggleInstanceLink,
  linkAllInstances,
  type SyncCategoryId,
} from '../../../features/settings/sync';
import { SyncSourceDialog } from '../../../features/settings/sync-source-dialog';
import { t } from '../../../localization';
import { Card } from '../parts';
import './sync.css';

/** Share game options, keybinds and servers using the host revisioned bundles. */
export function SyncSettings() {
  const [open, setOpen] = createSignal<SyncCategoryId>();
  return (
    <>
    <SyncSourceDialog />
    <Show when={syncError()}><p role="alert">{syncError()}</p></Show>
    <Show when={open()} fallback={<Overview onOpen={setOpen} />} keyed>
      {(id) => <Detail id={id} onBack={() => setOpen(undefined)} />}
    </Show>
    </>
  );
}

function Overview(props: { onOpen: (id: SyncCategoryId) => void }) {
  return (
    <>
      <p data-vesta="prefs-lede">{t('prefs.sync.lede')}</p>
      <ul data-vesta="prefs-sync-cards">
        <For each={syncCategories}>
          {(category) => {
            const state = () => syncState()[category.id];
            return (
              <li data-disabled={category.disabled ? '' : undefined} data-on={state().enabled ? '' : undefined}>
                <span data-vesta="prefs-sync-icon">
                  <Icon name={category.icon} size={20} />
                </span>
                <div>
                  <strong>{t(category.label)}</strong>
                  <span>{t(category.description)}</span>
                  <small>
                    {category.disabled
                      ? t('prefs.coming-soon')
                      : state().enabled
                        ? t('prefs.sync.linked', {
                            count: state().linked.length,
                          })
                        : t('prefs.sync.off')}
                  </small>
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
                  {t('common.edit')}
                </Button>
              </li>
            );
          }}
        </For>
      </ul>
    </>
  );
}

function Detail(props: { id: SyncCategoryId; onBack: () => void }) {
  // The page is keyed by category, so the id never changes while this component lives.
  const id = untrack(() => props.id);
  const category = syncCategories.find((item) => item.id === id)!;
  const [search, setSearch] = createSignal('');
  const [picking, setPicking] = createSignal(false);
  const [optionSearch, setOptionSearch] = createSignal('');
  const [name, setName] = createSignal('');
  const [address, setAddress] = createSignal('');
  const state = () => syncState()[id];
  const all = createMemo(() => instances());
  const shown = createMemo(() => {
    const needle = search().trim().toLowerCase();
    return all().filter((entry) => !needle || entry.instance.name.toLowerCase().includes(needle));
  });
  const linkedAll = () => all().length > 0 && all().every((entry) => state().linked.includes(entry.instance.id));
  const options = () =>
    availableSyncOptions(id).filter((option) =>
      option.toLowerCase().includes(optionSearch().trim().toLowerCase()),
    ) ?? [];

  return (
    <>
      <header data-vesta="prefs-subhead">
        <Button size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-back" />} onClick={props.onBack}>
          {t('common.back')}
        </Button>
        <h3>{t(category.label)}</h3>
        <Switch
          size="sm"
          label={t('prefs.sync.enabled')}
          checked={state().enabled}
          onChange={(enabled) => setSyncState(id, { enabled })}
        />
      </header>

      <Show when={id !== 'servers'}>
        <Card
          title={t('prefs.sync.shared-values')}
          description={t('prefs.sync.shared-values-description', {
            count: state().selected.length,
          })}
          action={
            <Button variant="outline" onClick={() => setPicking(true)}>
              {t('common.edit')}
            </Button>
          }
        >
          <Show
            when={state().selected.length}
            fallback={<p data-vesta="prefs-empty-line">{t('prefs.sync.nothing-shared')}</p>}
          >
            <ul data-vesta="prefs-chips">
              <For each={state().selected}>{(option) => <li>{option}</li>}</For>
            </ul>
          </Show>
        </Card>
      </Show>

        <Card
          title={t('prefs.sync.instances')}
          action={
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
          }
        >
          <div data-vesta="prefs-block">
            <TextField
              aria-label={t('common.search')}
              placeholder={t('common.search')}
              value={search()}
              onChange={setSearch}
            />
          </div>
          <Show when={shown().length} fallback={<p data-vesta="prefs-empty-line">{t('prefs.sync.no-instances')}</p>}>
            <ul data-vesta="prefs-sync-instances">
              <For each={shown()}>
                {(entry) => (
                  <li>
                    <img src={entry.instance.image} alt="" draggable="false" />
                    <div>
                      <strong>{entry.instance.name}</strong>
                      <span>{entry.instance.minecraftVersion}</span>
                    </div>
                    <Switch
                      size="sm"
                      aria-label={entry.instance.name}
                      checked={state().linked.includes(entry.instance.id)}
                      onChange={(on) => toggleInstanceLink(id, entry.instance.id, on)}
                    />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Card>

      <Show when={id === 'servers'}>
        <Card title={t('prefs.sync.servers-shared')}>
          <Show
            when={state().servers.length}
            fallback={<p data-vesta="prefs-empty-line">{t('prefs.sync.no-servers')}</p>}
          >
            <ul data-vesta="prefs-sync-instances">
              <For each={state().servers}>
                {(server) => (
                  <li>
                    <span data-vesta="prefs-sync-icon">
                      <Icon name="icons/content/server" size={16} />
                    </span>
                    <div>
                      <strong>{server.name}</strong>
                      <span>{server.address}</span>
                    </div>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      tone="danger"
                      label={t('prefs.sync.remove-server', {
                        name: server.name,
                      })}
                      icon={<Icon name="icons/actions/delete" />}
                      onClick={() =>
                        void removeSyncedServer(server.id)
                      }
                    />
                  </li>
                )}
              </For>
            </ul>
          </Show>
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
        </Card>
      </Show>

      <Dialog
        size="md"
        open={picking()}
        onOpenChange={setPicking}
        title={t('prefs.sync.pick-title')}
        description={t('prefs.sync.pick-description')}
        footer={
          <Button tone="accent" onClick={() => setPicking(false)}>
            {t('prefs.done')}
          </Button>
        }
      >
        <TextField
          aria-label={t('prefs.sync.search-options')}
          placeholder={t('prefs.sync.search-options')}
          value={optionSearch()}
          onChange={setOptionSearch}
        />
        <ul data-vesta="prefs-sync-instances" class="prefs-sync-options">
          <For each={options()}>
            {(option) => (
              <li>
                <div>
                  <strong>{option}</strong>
                </div>
                <Switch
                  size="sm"
                  aria-label={option}
                  checked={state().selected.includes(option)}
                  onChange={(on) =>
                    setSyncState(id, (current) => ({
                      selected: on ? [...current.selected, option] : current.selected.filter((item) => item !== option),
                    }))
                  }
                />
              </li>
            )}
          </For>
        </ul>
      </Dialog>
    </>
  );
}
