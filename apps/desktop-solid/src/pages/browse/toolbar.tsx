import { IconButton, SegmentedControl, Select } from '@vesta/ui';
import { createMemo, createSignal, onCleanup, onSettled, Show } from 'solid-js';
import { Icon } from '../../components/icon';
import { sourceById, sources, type ResourceType, type SourceId } from '../../features/browse/browse-model';
import { serverTypes } from '../../features/browse/browse-targets';
import {
  banners,
  prefetchBrowseType,
  setBanners,
  setSort,
  setSortOrder,
  setSource,
  serverTarget,
  setType,
  sort,
  sortOrder,
  source,
  type,
} from '../../features/browse/browse-store';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';

export const typeLabels: Record<ResourceType, MessageId> = {
  mod: 'browse.type-mod',
  plugin: 'browse.type-plugin',
  modpack: 'browse.type-modpack',
  server: 'browse.type-server',
  resourcepack: 'browse.type-resourcepack',
  shader: 'browse.type-shader',
  datapack: 'browse.type-datapack',
  world: 'browse.type-world',
};

const sourceOptions = sources.map((item) => ({
  value: item.id,
  label: item.label,
  icon: <Icon name={item.icon} size={16} />,
}));

/**
 * One line, read left to right the way browsing works: where (source, icon only), what (the
 * types that source offers, as tabs that become a Select in narrow panes), then how results are
 * ordered and drawn. The install target and filters live in the search field below.
 */
export function Toolbar() {
  let warmTimer: ReturnType<typeof setTimeout> | undefined;
  const warm = (event: Event) => {
    const row = (event.target as Element | null)?.closest('[data-vesta="segmented-item"]');
    const value = row?.querySelector<HTMLInputElement>('input')?.value as ResourceType | undefined;
    clearTimeout(warmTimer);
    if (value && value in typeLabels) warmTimer = setTimeout(() => prefetchBrowseType(value), 85);
  };
  onCleanup(() => clearTimeout(warmTimer));
  // A server target narrows the tabs to what it takes (Plugins for Paper, Mods for Fabric…).
  const allowedTypes = createMemo(
    () => {
      const server = serverTarget();
      return server ? serverTypes(server) : undefined;
    },
    { name: 'browseServerTypes' },
  );
  const typeOptions = createMemo(
    () => {
      const allowed = allowedTypes();
      return sourceById(source())
        .types.filter((value) => !allowed || allowed.includes(value) || value === type())
        .map((value) => ({ value, label: t(typeLabels[value]) }));
    },
    { name: 'browseTypeOptions' },
  );
  const sortOptions = createMemo(
    () => sourceById(source()).sortOptions.map((option) => ({ value: option.value, label: t(option.label) })),
    { name: 'browseSortOptions' },
  );
  const layoutOptions = createMemo(
    () => [
      { value: 'banner', label: t('browse.layout-banner'), icon: <Icon name="icons/content/card-banner" size={14} /> },
      { value: 'compact', label: t('browse.layout-compact'), icon: <Icon name="icons/content/card-compact" size={14} /> },
    ],
    { name: 'browseLayoutOptions' },
  );

  // The tabs become a Select as soon as they would push sort and layout onto a second line.
  // Measured rather than a fixed breakpoint: how wide the tabs are depends on the source, the
  // server target and the language. The tabs stay laid out (hidden) so they can be measured.
  let bar: HTMLDivElement | undefined;
  let tabs: HTMLElement | undefined;
  const [collapsed, setCollapsed] = createSignal(false, { name: 'browseTabsCollapsed' });
  onSettled(() => {
    if (!bar) return;
    tabs = bar.querySelector<HTMLElement>('.browse-type-tabs') ?? undefined;
    const fit = () => {
      if (!bar || !tabs) return;
      const gap = Number.parseFloat(getComputedStyle(bar).columnGap) || 0;
      const others = [...bar.children].filter((child) => child.getAttribute('data-vesta') !== 'browse-types');
      const needed = others.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + tabs.scrollWidth + gap * others.length;
      // A few pixels of slack: rounding would otherwise let the row wrap before this trips.
      const tight = needed + 4 > bar.clientWidth;
      setCollapsed(tight);
      // Hidden tabs leave the tab order and the accessibility tree; the Select stands in.
      tabs.inert = tight;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(bar);
    if (tabs) observer.observe(tabs);
    fit();
    return () => observer.disconnect();
  });

  return (
    <div data-vesta="browse-toolbar" ref={(element: HTMLDivElement) => (bar = element)} data-tabs-collapsed={collapsed() ? '' : undefined}>
      <SegmentedControl
        size="sm"
        iconOnly
        class="browse-sources"
        aria-label={t('browse.source-label')}
        options={sourceOptions}
        value={source()}
        onChange={(value) => setSource(value as SourceId)}
      />
      <div data-vesta="browse-types" onPointerOver={warm} onFocusIn={warm} onPointerLeave={() => clearTimeout(warmTimer)}>
        <SegmentedControl
          size="sm"
          class="browse-type-tabs"
          aria-hidden={collapsed() ? 'true' : undefined}
          aria-label={t('browse.type-label')}
          options={typeOptions()}
          value={type()}
          onChange={(value) => setType(value as ResourceType)}
        />
        <Select
          size="sm"
          class="browse-type-select"
          aria-label={t('browse.type-label')}
          options={typeOptions()}
          value={type()}
          onChange={(value) => setType(value as ResourceType)}
        />
      </div>
      <div data-vesta="browse-view">
        <div data-vesta="browse-sort">
          <Select
            size="sm"
            class="browse-sort-select"
            aria-label={t('browse.sort-label')}
            options={sortOptions()}
            value={sort()}
            onChange={setSort}
          />
          <Show when={sourceById(source()).sortOrder}>
            <IconButton
              size="sm"
              variant="ghost"
              label={sortOrder() === 'asc' ? t('browse.order-ascending') : t('browse.order-descending')}
              icon={
                <Icon
                  name={sortOrder() === 'asc' ? 'icons/controls/chevron-up' : 'icons/controls/chevron-down'}
                  size={14}
                />
              }
              onClick={() => setSortOrder(sortOrder() === 'asc' ? 'desc' : 'asc')}
            />
          </Show>
        </div>
        <SegmentedControl
          size="sm"
          iconOnly
          aria-label={t('browse.layout-label')}
          options={layoutOptions()}
          value={banners() ? 'banner' : 'compact'}
          onChange={(value) => setBanners(value === 'banner')}
        />
      </div>
    </div>
  );
}
