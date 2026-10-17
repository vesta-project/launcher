import { Popover } from '@vesta/ui';
import { createMemo, For, Show, untrack } from 'solid-js';
import { transitionTo } from '../../app/transition';
import { Icon } from '../../components/icon';
import {
  categoryDisplayName,
  creatorOf,
  formatCompact,
  formatRelative,
  initialOf,
  isLoaderCategory,
  ownerName,
  projectPath,
  typeUsesLoader,
  type ResourceProject,
} from '../../features/browse/browse-model';
import {
  banners,
  categories,
  derived,
  filterByCreator,
  installState,
  loader,
  sameState,
  source,
  setLoader,
  target,
  toggleCategory,
  type,
} from '../../features/browse/browse-store';
import { t } from '../../localization';
import { loaderLabels } from './filter-panel';
import { InstallButton } from './install-button';
import { runInstall } from './install-actions';

/** Tags shown before the rest fold into a "+N" pill. */
const shownTags = 3;

/** A stable hue per project, so the fallback banner differs between cards but never flickers. */
function hueOf(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return Math.abs(hash) % 360;
}

const loaded = (event: Event & { currentTarget: HTMLImageElement }) => (event.currentTarget.dataset.loaded = '');
const failed = (event: Event & { currentTarget: HTMLImageElement }) => (event.currentTarget.hidden = true);

/** A tag on a card: a category (or, for loader-aware types, a loader) it filters by. */
interface Tag {
  key: string;
  label: string;
  active: boolean;
  apply: () => void;
}

function TagButton(props: { tag: Tag }) {
  return (
    <button
      type="button"
      data-vesta="browse-tag"
      aria-pressed={props.tag.active ? 'true' : 'false'}
      data-tip={t('browse.filter-by-tag', { name: props.tag.label })}
      onClick={() => props.tag.apply()}
    >
      <span>{props.tag.label}</span>
    </button>
  );
}

/**
 * One result, in the spirit of the old launcher's card. With banners on: a short banner (gallery
 * image, else the blurred icon), the icon overlapping its lower edge with Install opposite, then
 * the name and one meta line across the full width, the summary and filter tags. Compact puts
 * the name beside the icon. The title link is stretched over the card, so the card is one
 * click target; author, tags and Install sit above it.
 */
export function ResultCard(props: { project: () => ResourceProject; index: () => number; enter: () => boolean }) {
  const project = () => props.project();
  const state = createMemo(() => installState(project()), { name: 'browseCardState', equals: sameState });
  const path = () => projectPath(project().source, project().id);
  const author = () => ownerName(project());
  const canFilterCreator = () => !!creatorOf(project());
  const banner = () => project().gallery[0] || project().featured_gallery || undefined;
  const updated = () => formatRelative(project().updated_at, Date.now());

  const tags = createMemo(
    (): Tag[] => {
      // Category ids belong to the displayed project's provider and resource type.
      if (source() !== project().source || type() !== project().resource_type) return [];
      const names = derived.names();
      const byName = new Map(derived.typeCategories().map((category) => [category.name.toLowerCase(), category.id]));
      const selected = new Set(categories());
      const loaderAware = typeUsesLoader(type());
      const pickedLoader = loader();
      const list: Tag[] = [];
      const seen = new Set<string>();
      for (const raw of project().categories) {
        if (isLoaderCategory(raw)) {
          // Loader tags filter by loader; they are noise once a loader is chosen.
          const id = raw.toLowerCase();
          if (!loaderAware || pickedLoader || seen.has(id)) continue;
          seen.add(id);
          list.push({ key: id, label: loaderLabels[id] ?? raw, active: false, apply: () => setLoader(id) });
          continue;
        }
        const id = names.has(raw) ? raw : (byName.get(raw.toLowerCase()) ?? raw);
        if (seen.has(id)) continue;
        seen.add(id);
        const label = names.get(id) ?? categoryDisplayName(raw);
        list.push({ key: id, label, active: selected.has(id), apply: () => toggleCategory(id) });
      }
      return list;
    },
    { name: 'browseCardTags' },
  );

  return (
    <article
      data-vesta="browse-card"
      data-banner={banners() ? '' : undefined}
      data-installed={state().kind === 'installed' || state().kind === 'update' ? '' : undefined}
      data-enter={untrack(props.enter) ? '' : undefined}
      data-platform={project().source}
      data-project={project().id}
      style={{ '--i': Math.min(props.index(), 10), '--browse-hue': hueOf(project().id) }}
    >
      <Show when={banners()}>
        <div data-vesta="browse-card-banner" aria-hidden="true">
          {/* No gallery image: the project's own icon, blurred, stands in so every card has colour. */}
          <Show
            when={banner()}
            fallback={
              <Show when={project().icon_url}>
                {(url) => <img data-backdrop="" src={url()} alt="" loading="lazy" decoding="async" onLoad={loaded} onError={failed} />}
              </Show>
            }
          >
            {(url) => <img src={url()} alt="" loading="lazy" decoding="async" onLoad={loaded} onError={failed} />}
          </Show>
        </div>
      </Show>
      <div data-vesta="browse-card-body">
        <span data-vesta="browse-card-icon" aria-hidden="true">
          <span data-vesta="browse-card-initial">{initialOf(project().name)}</span>
          <Show when={project().icon_url}>
            {(url) => <img src={url()} alt="" loading="lazy" decoding="async" onLoad={loaded} onError={failed} />}
          </Show>
        </span>
        <div data-vesta="browse-card-title">
          <a
            href={`#${path()}`}
            data-vesta="browse-card-name"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              transitionTo(path());
            }}
          >
            {project().name}
          </a>
          {/* One line: author first; stats that do not fit wrap out of sight rather than squeeze. */}
          <div data-vesta="browse-card-meta">
            <Show when={author()}>
              <Show
                when={canFilterCreator()}
                fallback={<span data-vesta="browse-card-author">{t('browse.by-author', { author: author() })}</span>}
              >
                <button
                  type="button"
                  data-vesta="browse-card-author"
                  data-tip={t('browse.filter-by-author', { author: author() })}
                  onClick={() => filterByCreator(project())}
                >
                  {t('browse.by-author', { author: author() })}
                </button>
              </Show>
            </Show>
            <span data-vesta="browse-card-stat" data-tip={t('browse.downloads-title', { count: project().download_count })}>
              <Icon name="icons/actions/download" size={11} />
              {formatCompact(project().download_count)}
            </span>
            <Show when={project().follower_count > 0}>
              <span data-vesta="browse-card-stat" data-tip={t('browse.followers-title', { count: project().follower_count })}>
                <Icon name="icons/content/heart" size={11} />
                {formatCompact(project().follower_count)}
              </span>
            </Show>
            <Show when={updated()}>
              <span data-vesta="browse-card-stat">
                <Icon name="icons/content/history" size={11} />
                {updated()}
              </span>
            </Show>
          </div>
        </div>
        <span data-vesta="browse-card-action">
          <InstallButton
            state={state}
            targetName={() => target()?.name}
            onRun={() => void runInstall(project(), project().resource_type, target())}
          />
        </span>
        <Show when={project().summary}>
          <p data-vesta="browse-card-summary">{project().summary}</p>
        </Show>
        <Show when={tags().length}>
          <div data-vesta="browse-card-tags">
            <For each={tags().slice(0, shownTags)} keyed={(tag) => tag.key}>
              {(tag) => <TagButton tag={tag()} />}
            </For>
            <Show when={tags().length > shownTags}>
              <Popover
                placement="bottom-start"
                class="browse-tags-popover"
                trigger={(triggerProps) => (
                  <button
                    {...triggerProps}
                    type="button"
                    data-vesta="browse-tag"
                    data-kind="more"
                    aria-label={t('browse.more-categories', { count: tags().length - shownTags })}
                  >
                    {t('browse.more-tags', { count: tags().length - shownTags })}
                  </button>
                )}
              >
                <div data-vesta="browse-tags-more">
                  <For each={tags().slice(shownTags)} keyed={(tag) => tag.key}>
                    {(tag) => <TagButton tag={tag()} />}
                  </For>
                </div>
              </Popover>
            </Show>
          </div>
        </Show>
      </div>
    </article>
  );
}
