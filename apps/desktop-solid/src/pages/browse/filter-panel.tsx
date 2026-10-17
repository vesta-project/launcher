import { Button, Combobox, Select, Switch } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { createMemo, createSignal, For, onSettled, Show } from 'solid-js';
import { Icon } from '../../components/icon';
import {
  supportsEnvironment,
  typeUsesLoader,
  type CategoryGroup,
  type CategoryItem,
} from '../../features/browse/browse-model';
import {
  categories,
  clearFilters,
  client,
  creator,
  derived,
  expandedGroups,
  gameVersion,
  loader,
  results,
  server,
  setClient,
  setCreator,
  setGameVersion,
  setLoader,
  setServer,
  source,
  toggleCategory,
  toggleGroup,
  type,
} from '../../features/browse/browse-store';
import { loadMetadata, metadata } from '../../features/instances/metadata';
import { nativeInstances } from '../../features/instances/native-service';
import { experimentalVersion, minecraftVersions } from '../../features/instances/versions';
import { t } from '../../localization';
import { CategoryIcon } from './category-icon';
import { TargetSelect } from './target-select';

export type Section = 'instance' | 'version' | 'loader' | 'environment' | 'creator' | 'categories';

export const loaderLabels: Record<string, string> = {
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
};
const loaderOrder = ['fabric', 'forge', 'quilt', 'neoforge'];

function Toggle(props: { pressed: boolean; onClick: () => void; children: JSX.Element; title?: string }) {
  return (
    <button
      type="button"
      data-vesta="browse-toggle"
      aria-pressed={props.pressed ? 'true' : 'false'}
      data-tip={props.title}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

function CategoryToggle(props: { item: CategoryItem; selected: () => ReadonlySet<string> }) {
  return (
    <Toggle
      pressed={props.selected().has(props.item.id)}
      onClick={() => toggleCategory(props.item.id)}
      title={props.item.name}
    >
      <CategoryIcon icon={props.item.icon} />
      <span data-vesta="browse-toggle-label">{props.item.name}</span>
    </Toggle>
  );
}

/**
 * One category group. CurseForge parents are a header bar: the name selects the parent
 * category, the chevron expands its children (kept open while one of them is selected).
 * Flat groups (Modrinth, CurseForge's ungrouped entries) have no header and are always open.
 */
function CategoryGroupView(props: { group: CategoryGroup; selected: () => ReadonlySet<string> }) {
  const id = () => props.group.id ?? props.group.name;
  const open = () =>
    !props.group.id || expandedGroups().has(id()) || props.group.items.some((item) => props.selected().has(item.id));
  return (
    <div data-vesta="browse-group">
      <Show when={props.group.id}>
        {(parent) => (
          <div data-vesta="browse-group-head" data-active={props.selected().has(parent()) ? '' : undefined}>
            <button
              type="button"
              data-vesta="browse-group-title"
              aria-pressed={props.selected().has(parent()) ? 'true' : 'false'}
              onClick={() => toggleCategory(parent())}
            >
              <CategoryIcon icon={props.group.icon} />
              <span data-vesta="browse-toggle-label">{props.group.name}</span>
            </button>
            <button
              type="button"
              data-vesta="browse-group-toggle"
              aria-expanded={open() ? 'true' : 'false'}
              aria-label={t('browse.toggle-group', { name: props.group.name })}
              onClick={() => toggleGroup(id())}
            >
              <Icon name="icons/controls/chevron-down" size={14} />
            </button>
          </div>
        )}
      </Show>
      <Show when={open()}>
        <div data-vesta="browse-grid" data-nested={props.group.id ? '' : undefined}>
          <For each={props.group.items}>{(item) => <CategoryToggle item={item} selected={props.selected} />}</For>
        </div>
      </Show>
    </div>
  );
}

/** Minecraft versions: releases, optionally with snapshots, always including the current pick. */
function versionOptions(snapshots: boolean, current: string | null) {
  const ids = nativeInstances
    ? (metadata()?.game_versions ?? [])
        .filter((version) => snapshots || version.version_type === 'release')
        .map((version) => version.id)
    : minecraftVersions().filter((id) => snapshots || !experimentalVersion(id));
  const list = current && !ids.includes(current) ? [current, ...ids] : ids;
  return [{ value: '', label: t('browse.any-version') }, ...list.map((id) => ({ value: id, label: id }))];
}

function PanelSection(props: { id: Section; title: string; children: JSX.Element; aside?: JSX.Element }) {
  return (
    <section data-vesta="browse-section" data-section={props.id}>
      <div data-vesta="browse-section-head">
        <h3 data-vesta="browse-section-title">{props.title}</h3>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

/**
 * Live-applying filters, laid out like the old launcher's popover: instance, Minecraft
 * version, loader, environment, categories, then reset. Mounted only while it is open.
 */
export function FilterPanel(props: { section: () => Section | undefined }) {
  let root: HTMLDivElement | undefined;
  const [snapshots, setSnapshots] = createSignal(!!gameVersion() && experimentalVersion(gameVersion() as string), {
    name: 'browseShowSnapshots',
  });
  const selected = createMemo(() => new Set(categories()), { name: 'browseSelectedCategories' });
  const versions = createMemo(() => versionOptions(snapshots(), gameVersion()), { name: 'browseVersionOptions' });
  const loaderOptions = createMemo(
    () => [
      { value: '', label: t('browse.any-loader') },
      ...loaderOrder.map((id) => ({ value: id, label: loaderLabels[id] })),
    ],
    { name: 'browseLoaderOptions' },
  );

  onSettled(() => {
    void loadMetadata();
    const section = props.section();
    if (section) root?.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  return (
    <div data-vesta="browse-panel" ref={(element: HTMLDivElement) => (root = element)}>
      <div data-vesta="browse-panel-body">
        <PanelSection id="instance" title={t('browse.section-instance')}>
          <TargetSelect />
          <Show when={type() === 'modpack'}>
            <p data-vesta="browse-section-note">{t('browse.instance-modpack-note')}</p>
          </Show>
        </PanelSection>

        <PanelSection
          id="version"
          title={t('browse.section-version')}
          aside={<Switch size="sm" label={t('browse.show-snapshots')} checked={snapshots()} onChange={setSnapshots} />}
        >
          <Combobox
            size="sm"
            aria-label={t('browse.section-version')}
            placeholder={t('browse.any-version')}
            options={versions()}
            value={gameVersion() ?? ''}
            onChange={(value) => setGameVersion(value || null)}
          />
        </PanelSection>

        <Show when={typeUsesLoader(type())}>
          <PanelSection id="loader" title={t('browse.section-loader')}>
            <Select
              size="sm"
              aria-label={t('browse.section-loader')}
              options={loaderOptions()}
              value={loader() ?? ''}
              onChange={(value) => setLoader(value || null)}
            />
          </PanelSection>
        </Show>

        <Show when={supportsEnvironment(source(), type())}>
          <PanelSection id="environment" title={t('browse.section-environment')}>
            <div data-vesta="browse-pair" role="group" aria-label={t('browse.section-environment')}>
              <Toggle pressed={client()} onClick={() => setClient(!client())}>
                <Icon name="icons/content/monitor" size={12} />
                <span data-vesta="browse-toggle-label">{t('browse.environment-client')}</span>
              </Toggle>
              <Toggle pressed={server()} onClick={() => setServer(!server())}>
                <Icon name="icons/content/server" size={12} />
                <span data-vesta="browse-toggle-label">{t('browse.environment-server')}</span>
              </Toggle>
            </div>
          </PanelSection>
        </Show>

        <Show when={creator()}>
          {(current) => (
            <PanelSection id="creator" title={t('browse.section-creator')}>
              <div data-vesta="browse-row">
                <span data-vesta="browse-creator">{current().name}</span>
                <Button size="sm" variant="ghost" onClick={() => setCreator(null)}>
                  {t('browse.clear-creator')}
                </Button>
              </div>
            </PanelSection>
          )}
        </Show>

        <Show when={derived.groups().length}>
          <PanelSection id="categories" title={t('browse.section-categories')}>
            <div data-vesta="browse-groups">
              <For each={derived.groups()}>{(group) => <CategoryGroupView group={group} selected={selected} />}</For>
            </div>
          </PanelSection>
        </Show>
      </div>

      <footer data-vesta="browse-panel-foot">
        <span data-vesta="browse-panel-count" role="status">
          {t('browse.results-count', { count: results()?.total ?? 0 })}
        </span>
        <Button size="sm" variant="ghost" tone="accent" onClick={() => clearFilters()}>
          {t('browse.reset-filters')}
        </Button>
      </footer>
    </div>
  );
}
