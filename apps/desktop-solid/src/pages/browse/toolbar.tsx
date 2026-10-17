import { IconButton, SegmentedControl, Select, Switch } from '@vesta/ui';
import { createMemo, Show } from 'solid-js';
import { Icon } from '../../components/icon';
import {
  resourceTypes,
  sourceById,
  sourcesForType,
  type ResourceType,
  type SourceId,
} from '../../features/browse/browse-model';
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
import { TargetSelect } from './target-select';

const typeLabels: Record<ResourceType, MessageId> = {
  mod: 'browse.type-mod',
  modpack: 'browse.type-modpack',
  resourcepack: 'browse.type-resourcepack',
  shader: 'browse.type-shader',
  datapack: 'browse.type-datapack',
  world: 'browse.type-world',
};

/**
 * Type, source, install target, sort and the banner toggle. The type control collapses to a
 * Select in narrow panes (CSS).
 */
export function Toolbar() {
  const typeOptions = createMemo(() => resourceTypes.map((value) => ({ value, label: t(typeLabels[value]) })), {
    name: 'browseTypeOptions',
  });
  const sourceOptions = createMemo(
    () =>
      sourcesForType(type()).map((item) => ({
        value: item.id,
        label: item.label,
        icon: <Icon name={item.icon} size={14} />,
      })),
    { name: 'browseSourceOptions' },
  );
  const sortOptions = createMemo(
    () => sourceById(source()).sortOptions.map((option) => ({ value: option.value, label: t(option.label) })),
    { name: 'browseSortOptions' },
  );

  return (
    <div data-vesta="browse-toolbar">
      <div data-vesta="browse-type">
        <SegmentedControl
          size="sm"
          aria-label={t('browse.type-label')}
          options={typeOptions()}
          value={type()}
          onChange={(value) => setType(value as ResourceType)}
        />
        <Select
          size="sm"
          aria-label={t('browse.type-label')}
          options={typeOptions()}
          value={type()}
          onChange={(value) => setType(value as ResourceType)}
        />
      </div>
      <div data-vesta="browse-controls">
        <SegmentedControl
          size="sm"
          aria-label={t('browse.source-label')}
          options={sourceOptions()}
          value={source()}
          onChange={(value) => setSource(value as SourceId)}
        />
        <label data-vesta="browse-target">
          <span>{t('browse.install-to')}</span>
          <TargetSelect />
        </label>
        <div data-vesta="browse-sort">
          <Select
            size="sm"
            aria-label={t('browse.sort-label')}
            options={sortOptions()}
            value={sort()}
            onChange={setSort}
          />
          <Show when={sourceById(source()).sortOrder}>
            <IconButton
              size="sm"
              variant="outline"
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
        <Switch size="sm" label={t('browse.banners')} checked={banners()} onChange={setBanners} />
      </div>
    </div>
  );
}
