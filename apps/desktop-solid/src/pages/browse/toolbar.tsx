import { IconButton, SegmentedControl, Select } from '@vesta/ui';
import { createMemo, Show } from 'solid-js';
import { Icon } from '../../components/icon';
import { sourceById, sources, type ResourceType, type SourceId } from '../../features/browse/browse-model';
import {
  banners,
  setBanners,
  setSort,
  setSortOrder,
  setSource,
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
  modpack: 'browse.type-modpack',
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
  const typeOptions = createMemo(
    () => sourceById(source()).types.map((value) => ({ value, label: t(typeLabels[value]) })),
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

  return (
    <div data-vesta="browse-toolbar">
      <SegmentedControl
        size="sm"
        iconOnly
        class="browse-sources"
        aria-label={t('browse.source-label')}
        options={sourceOptions}
        value={source()}
        onChange={(value) => setSource(value as SourceId)}
      />
      <div data-vesta="browse-types">
        <SegmentedControl
          size="sm"
          class="browse-type-tabs"
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
