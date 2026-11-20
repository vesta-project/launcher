import { Button, Pagination, Select, Skeleton } from '@vesta/ui';
import { createEffect, createMemo, createSignal, For, Match, onSettled, Show, Switch, untrack } from 'solid-js';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import {
  pageCount,
  maxBrowsePageSize,
  pageSizes,
  queryKey,
  type ResourceProject,
  type SourceId,
} from '../../features/browse/browse-model';
import { prefetchProject } from '../../features/browse/browse-projects';
import {
  clearFilters,
  failure,
  hasActiveFilters,
  page,
  pending,
  query,
  recalledScroll,
  rememberScroll,
  visibleBrowseResults,
  retry,
  banners,
  setPage,
  setPageSize,
  warning,
} from '../../features/browse/browse-store';
import { t } from '../../localization';
import { NoticeBar } from './notice-bar';
import { ResultCard } from './result-card';
import { Notice } from '../../components/notice';

const sizeOptions = pageSizes.map((size) => ({ value: String(size), label: String(size) }));
const skeletons = Array.from({ length: 8 }, (_, index) => index);
/** Cards rendered in the first frame (a screenful), then per following idle slot. */
const firstCards = 12;
const cardsPerFrame = 8;

const reducedMotion = () =>
  document.documentElement.hasAttribute('data-vesta-reduced-motion') ||
  matchMedia('(prefers-reduced-motion: reduce)').matches;

const cardOf = (node: EventTarget | null) =>
  (node as Element | null)?.closest?.<HTMLElement>('[data-vesta="browse-card"]') ?? null;

/** Placeholders shaped like the cards they stand in for, so nothing jumps when results land. */
function Skeletons() {
  return (
    <div data-vesta="browse-list" aria-hidden="true">
      <For each={skeletons}>
        {() => (
          <div data-vesta="browse-card" data-skeleton="" data-banner={banners() ? '' : undefined}>
            <Show when={banners()}>
              <div data-vesta="browse-card-banner" />
            </Show>
            <div data-vesta="browse-card-body">
              <span data-vesta="browse-card-icon" />
              <div data-vesta="browse-card-title">
                <Skeleton width={140} height={14} />
                <Skeleton width={110} height={11} />
              </div>
              <div data-vesta="browse-card-summary">
                <Skeleton height={11} />
                <Skeleton width={180} height={11} />
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

/**
 * The scrolling pane: states, cards, then pagination and page size. The count lives in the search field.
 * `active` is false while a project page covers the list; the list stays mounted underneath.
 */
export function Results(props: { active: () => boolean }) {
  let pane: HTMLDivElement | undefined;
  let top = 0;
  let shownBase: string | undefined;
  let shownKey: string | undefined;
  let hoveredCard: HTMLElement | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  const displayed = createMemo(visibleBrowseResults, { name: 'visibleBrowsePage' });
  const enter = () => (recalledScroll(displayed()?.key ?? '') ?? 0) === 0;

  const total = () => displayed()?.total ?? 0;
  const pages = createMemo(() => pageCount(total(), query().pageSize), { name: 'browsePages' });

  // A page of up to 100 cards is too much for one frame: the first screenful renders with the
  // result set and the rest follow a batch per frame, so a click answers at once. A set with a
  // remembered scroll position renders whole, because that position needs the cards above it.
  const [progress, setProgress] = createSignal<{ key?: string; count: number }>({ count: 0 }, { name: 'browseRenderedCards' });
  const rendered = () => {
    const key = displayed()?.key;
    const current = progress();
    if (current.key === key) return current.count;
    return key !== undefined && (recalledScroll(key) ?? 0) > 0 ? Number.POSITIVE_INFINITY : firstCards;
  };
  createEffect(
    () => [displayed()?.key, rendered(), displayed()?.hits.length ?? 0] as const,
    ([key, count, length]) => {
      if (count >= length) return;
      // After the current frame has painted, and before input only when the window is idle.
      const more = () => setProgress({ key, count: Math.min(count + cardsPerFrame, length) });
      if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(more, { timeout: 120 });
        return () => cancelIdleCallback(handle);
      }
      const timer = setTimeout(more, 16);
      return () => clearTimeout(timer);
    },
  );

  // Scroll position belongs to the shown result set: remembered when it is replaced or the
  // page is left, restored when it comes back. Changing page scrolls to the top smoothly.
  createEffect(
    () => displayed()?.key,
    (key) => {
      if (!pane || key === shownKey) return;
      if (shownKey !== undefined) rememberScroll(shownKey, top);
      shownKey = key;
      if (key === undefined) return;
      const base = queryKey(untrack(query), false);
      const samePage = shownBase === base;
      shownBase = base;
      pane.scrollTo({ top: recalledScroll(key) ?? 0, behavior: samePage && !reducedMotion() ? 'smooth' : 'instant' });
    },
  );

  // Hidden (under a project page or another page) the pane has no box and may lose its offset;
  // put it back when shown again. Only then: on mount the restore above owns the position.
  let hidden = false;
  createEffect(props.active, (active) => {
    if (!active) {
      hidden = true;
      return;
    }
    if (hidden && pane && pane.scrollTop !== top) pane.scrollTop = top;
    hidden = false;
  });

  onSettled(() => () => {
    clearTimeout(hoverTimer);
    if (shownKey) rememberScroll(shownKey, top);
  });

  // Warm only the first two cards after rendering; hover/focus uses the same bounded queue.
  createEffect(
    () => displayed()?.key,
    () => {
      const projects = untrack(() => displayed()?.hits.slice(0, 2) ?? []);
      const warm = () => projects.forEach((project) => prefetchProject(project.source, project.id));
      if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(warm, { timeout: 1500 });
        return () => cancelIdleCallback(handle);
      }
      const timer = setTimeout(warm, 300);
      return () => clearTimeout(timer);
    },
  );

  const hover = (event: PointerEvent) => {
    const card = cardOf(event.target);
    if (!card || card === hoveredCard) return;
    clearTimeout(hoverTimer);
    hoveredCard = card;
    hoverTimer = setTimeout(
      () => prefetchProject(card.dataset.platform as SourceId, card.dataset.project as string),
      150,
    );
  };
  const leave = (event: PointerEvent) => {
    if (hoveredCard && !hoveredCard.contains(event.relatedTarget as Node | null)) {
      clearTimeout(hoverTimer);
      hoveredCard = null;
    }
  };
  const focus = (event: FocusEvent) => {
    const card = cardOf(event.target);
    if (card) prefetchProject(card.dataset.platform as SourceId, card.dataset.project as string);
  };

  const hits = (): ResourceProject[] => displayed()?.hits ?? [];
  const renderedHits = () => {
    const all = hits();
    return rendered() >= all.length ? all : all.slice(0, rendered());
  };

  return (
    <section data-vesta="browse-results" aria-label={t('browse.results-label')}>
      <div
        data-vesta="browse-pane"
        ref={(element: HTMLDivElement) => (pane = element)}
        onScroll={(event) => {
          if (props.active()) top = event.currentTarget.scrollTop;
        }}
      >
        <NoticeBar />
        <Show when={warning()}>
          <p data-vesta="browse-warning" role="status">
            <Icon name="icons/controls/warning" size={12} />
            {t('browse.cached-warning')}
          </p>
        </Show>
        <Switch>
          <Match when={!pending() && failure()}>
            {(message) => (
              <div data-vesta="browse-error">
                <Notice details={message()} action={{ label: t('browse.retry'), onClick: () => void retry() }}>
                  {t('browse.error-title')}
                </Notice>
              </div>
            )}
          </Match>
          <Match when={!displayed()}>
            <Skeletons />
          </Match>
          <Match when={!hits().length}>
            <EmptyState
              variant="inline"
              icon="icons/content/search"
              title={t('browse.empty-title')}
              description={t('browse.empty-description')}
            >
              <Show when={hasActiveFilters()}>
                <Button size="sm" onClick={() => clearFilters()}>
                  {t('browse.clear-all')}
                </Button>
              </Show>
            </EmptyState>
          </Match>
          <Match when={true}>
            <div
              data-vesta="browse-list"
              data-pending={pending() ? '' : undefined}
              onPointerOver={hover}
              onPointerOut={leave}
              onFocusIn={focus}
            >
              <For each={renderedHits()} keyed={(project) => `${project.source}:${project.id}`}>
                {(project, index) => <ResultCard project={project} index={index} enter={enter} />}
              </For>
            </div>
            {/* Pages and page size share the foot of the list; neither is worth a line at the top. */}
            <footer data-vesta="browse-pages">
              <Show when={pages() > 1}>
                <Pagination
                  count={pages()}
                  page={page()}
                  onPageChange={setPage}
                  previousLabel={t('browse.previous')}
                  nextLabel={t('browse.next')}
                  aria-label={t('browse.pages-label')}
                />
              </Show>
              <label data-vesta="browse-page-size">
                <span>{t('browse.per-page')}</span>
                <Select
                  size="sm"
                  aria-label={t('browse.per-page')}
                  options={sizeOptions.filter((option) => Number(option.value) <= maxBrowsePageSize(query().source))}
                  value={String(query().pageSize)}
                  onChange={(value) => setPageSize(Number(value))}
                />
              </label>
            </footer>
          </Match>
        </Switch>
      </div>
    </section>
  );
}
