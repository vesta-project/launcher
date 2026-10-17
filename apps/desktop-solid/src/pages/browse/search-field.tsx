import { Badge, Button, IconButton, Popover } from '@vesta/ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { transitionTo } from '../../app/transition';
import { Icon } from '../../components/icon';
import {
  categoryLabel,
  parseOperators,
  parseProjectUrl,
  projectPath,
  supportsEnvironment,
  typeUsesLoader,
  type ProjectUrl,
} from '../../features/browse/browse-model';
import {
  activeFilterCount,
  categories,
  client,
  commitText,
  creator,
  derived,
  gameVersion,
  hasActiveFilters,
  loader,
  removeTarget,
  replaceText,
  server,
  setClient,
  setCreator,
  setGameVersion,
  setLoader,
  setServer,
  clearFilters,
  setText,
  target,
  targetId,
  text,
  toggleCategory,
  type,
  source,
} from '../../features/browse/browse-store';
import { t } from '../../localization';
import { FilterPanel, loaderLabels, type Section } from './filter-panel';
import './search-field.css';

/** The input, so the `/` shortcut and the app's search command can focus it. */
export const searchInput: { element?: HTMLInputElement } = {};

interface Chip {
  key: string;
  kind: 'instance' | 'version' | 'loader' | 'environment' | 'creator' | 'category';
  label: string;
  section: Section;
  remove: () => void;
}

/** Active filters as removable tokens, in the order the panel lists them. */
function buildChips(): Chip[] {
  const chips: Chip[] = [];
  const instance = target();
  if (targetId() && type() !== 'modpack')
    chips.push({
      key: 'instance',
      kind: 'instance',
      label: instance?.name ?? `#${targetId()}`,
      section: 'instance',
      remove: removeTarget,
    });
  const version = gameVersion();
  if (version)
    chips.push({
      key: 'version',
      kind: 'version',
      label: version,
      section: 'version',
      remove: () => setGameVersion(null),
    });
  const picked = loader();
  if (picked && typeUsesLoader(type()))
    chips.push({
      key: 'loader',
      kind: 'loader',
      label: loaderLabels[picked] ?? picked,
      section: 'loader',
      remove: () => setLoader(null),
    });
  if (supportsEnvironment(source(), type())) {
    if (client())
      chips.push({
        key: 'client',
        kind: 'environment',
        label: t('browse.environment-client'),
        section: 'environment',
        remove: () => setClient(false),
      });
    if (server())
      chips.push({
        key: 'server',
        kind: 'environment',
        label: t('browse.environment-server'),
        section: 'environment',
        remove: () => setServer(false),
      });
  }
  const author = creator();
  if (author)
    chips.push({
      key: 'creator',
      kind: 'creator',
      label: author.name,
      section: 'creator',
      remove: () => setCreator(null),
    });
  for (const id of categories())
    chips.push({
      key: `category:${id}`,
      kind: 'category',
      label: categoryLabel(id, derived.names()),
      section: 'categories',
      remove: () => toggleCategory(id),
    });
  return chips;
}

/** With more chips than this the strip shows the first `shownWhenCollapsed` and a "+N" chip. */
const maxChips = 3;
const shownWhenCollapsed = 2;

function openProject(url: ProjectUrl) {
  replaceText('');
  transitionTo(projectPath(url.platform, url.id));
}

/**
 * The signature search box: filter chips, the text input and the Filters button live in one
 * field-looking container. Keys in the input: Enter commits (or opens a pasted project URL),
 * Backspace on empty text removes the last chip (hidden ones included), Escape clears the text
 * and then blurs, ArrowDown opens the filter panel (Escape closes it again). Many filters
 * collapse to the first few chips and a "+N" chip that opens the panel.
 */
export function SearchField() {
  let box: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false, { name: 'browseFiltersOpen' });
  const [section, setSection] = createSignal<Section | undefined>(undefined, { name: 'browseFiltersSection' });
  const chips = createMemo(buildChips, { name: 'browseChips' });
  const link = createMemo(() => parseProjectUrl(text()), {
    name: 'browseProjectLink',
    equals: (a, b) => a?.platform === b?.platform && a?.id === b?.id,
  });

  const shown = createMemo(() => (chips().length > maxChips ? chips().slice(0, shownWhenCollapsed) : chips()), {
    name: 'browseShownChips',
  });
  const hidden = () => chips().length - shown().length;

  const openPanel = (at?: Section) => {
    setSection(at);
    setOpen(true);
  };

  const applyText = (value: string, commitTrailing: boolean) => {
    const parsed = parseOperators(value, { commitTrailing });
    if (!parsed.didExtract) {
      setText(value);
      if (commitTrailing) commitText();
      return;
    }
    if (parsed.gameVersion) setGameVersion(parsed.gameVersion);
    if (parsed.loader) setLoader(parsed.loader);
    replaceText(parsed.remainder);
  };

  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.isComposing) return;
    const input = event.currentTarget;
    if (event.key === 'Enter') {
      event.preventDefault();
      const url = link();
      if (url) openProject(url);
      else applyText(input.value, true);
    } else if (event.key === 'Backspace' && !input.value) {
      const last = chips().at(-1);
      if (last) {
        event.preventDefault();
        last.remove();
      }
    } else if (event.key === 'Escape') {
      if (input.value) {
        event.preventDefault();
        event.stopPropagation();
        replaceText('');
      } else input.blur();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      openPanel();
    }
  };

  return (
    <div data-vesta="browse-search-wrap">
      <div
        data-vesta="browse-search"
        ref={(element: HTMLDivElement) => (box = element)}
        onClick={(event) => {
          if (event.target === event.currentTarget) searchInput.element?.focus();
        }}
      >
        <span data-vesta="browse-search-icon" aria-hidden="true">
          <Icon name="icons/content/search" size={14} />
        </span>
        <div data-vesta="browse-chips">
          <For each={shown()} keyed={(chip) => chip.key}>
            {(chip) => (
              <span data-vesta="browse-chip" data-kind={chip().kind}>
                <button type="button" data-vesta="browse-chip-body" onClick={() => openPanel(chip().section)}>
                  {chip().label}
                </button>
                <button
                  type="button"
                  data-vesta="browse-chip-remove"
                  aria-label={t('browse.remove-filter', { name: chip().label })}
                  onClick={() => chip().remove()}
                >
                  <Icon name="icons/actions/close" size={10} />
                </button>
              </span>
            )}
          </For>
          <Show when={hidden()}>
            <button
              type="button"
              data-vesta="browse-chip"
              data-kind="more"
              title={chips()
                .slice(shown().length)
                .map((chip) => chip.label)
                .join(', ')}
              aria-label={t('browse.more-filters', { count: hidden() })}
              onClick={() => openPanel()}
            >
              {t('browse.more-tags', { count: hidden() })}
            </button>
          </Show>
        </div>
        <input
          type="search"
          data-vesta="browse-search-input"
          ref={(element: HTMLInputElement) => (searchInput.element = element)}
          value={text()}
          placeholder={t('browse.search-placeholder')}
          aria-label={t('browse.search-label')}
          autocomplete="off"
          spellcheck="false"
          onInput={(event) => applyText(event.currentTarget.value, false)}
          onKeyDown={onKeyDown}
        />
        <Show when={hasActiveFilters()}>
          <IconButton
            size="sm"
            variant="ghost"
            label={t('browse.clear-search')}
            icon={<Icon name="icons/actions/close" size={12} />}
            onClick={() => {
              clearFilters();
              searchInput.element?.focus();
            }}
          />
        </Show>
        <span data-vesta="browse-filters-slot">
          <Popover
            open={open()}
            onOpenChange={setOpen}
            placement="bottom-end"
            class="browse-filters-popover"
            anchorRef={() => box}
            trigger={(triggerProps) => (
              <Button
                {...triggerProps}
                data-active={activeFilterCount() ? '' : undefined}
                size="sm"
                variant="ghost"
                icon={<Icon name="icons/content/filter" size={14} />}
                onClick={() => {
                  setSection(undefined);
                  setOpen(!open());
                }}
              >
                {t('browse.filters')}
                <Show when={activeFilterCount()}>
                  <Badge size="sm" tone="accent" variant="solid">
                    {String(activeFilterCount())}
                  </Badge>
                </Show>
              </Button>
            )}
          >
            <FilterPanel section={section} />
          </Popover>
        </span>
      </div>
      <Show when={link()}>
        {(url) => (
          <button type="button" data-vesta="browse-url-hint" onClick={() => openProject(url())}>
            <span>{t('browse.open-link', { value: text().trim() })}</span>
            <Icon name="icons/navigation/arrow-forward" size={12} />
          </button>
        )}
      </Show>
    </div>
  );
}
