import { Button, Pagination, Progress, Select, Skeleton } from '@vesta/ui';
import { createEffect, createMemo, For, Match, onSettled, Show, Switch, untrack } from 'solid-js';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import {
  pageCount,
  pageSizes,
  queryKey,
  type ResourceProject,
  type SourceId,
} from '../../features/browse/browse-model';
import { prefetchProject } from '../../features/browse/browse-projects';
import {
  clearFilters,
  failure,
  generation,
  hasActiveFilters,
  notice,
  page,
  pageSize,
  pending,
  query,
  recalledScroll,
  rememberScroll,
  results,
  retry,
  setNotice,
  banners,
  setPage,
  setPageSize,
  warning,
} from '../../features/browse/browse-store';
import { t } from '../../localization';
import { ResultCard } from './result-card';

const sizeOptions = pageSizes.map((size) => ({ value: String(size), label: String(size) }));
const skeletons = Array.from({ length: 8 }, (_, index) => index);

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
              <div data-vesta="browse-card-head">
                <span data-vesta="browse-card-icon" />
                <div data-vesta="browse-card-title">
                  <Skeleton width={140} height={14} />
                  <Skeleton width={90} height={11} />
                </div>
              </div>
              <Skeleton height={11} />
              <Skeleton width={180} height={11} />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

/** Count and page size, then the scrolling pane with states, cards and pagination. */
export function Results() {
  let pane: HTMLDivElement | undefined;
  let top = 0;
  let shownBase: string | undefined;
  let hoveredCard: HTMLElement | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  // Cards created after the result set changed fade in; a page restored on return does not.
  const mounted = untrack(generation);
  const enter = () => generation() !== mounted || !untrack(results);

  const total = () => results()?.total ?? 0;
  const pages = createMemo(() => pageCount(total(), pageSize()), { name: 'browsePages' });

  // Scroll position belongs to the shown result set: remembered when it is replaced or the
  // page is left, restored when it comes back. Changing page scrolls to the top smoothly.
  createEffect(
    () => results()?.key,
    (key, previous) => {
      if (!pane || key === undefined) return;
      if (previous !== undefined && previous !== key) rememberScroll(previous, top);
      const base = queryKey(untrack(query), false);
      const samePage = shownBase === base && previous !== undefined;
      shownBase = base;
      pane.scrollTo({ top: recalledScroll(key) ?? 0, behavior: samePage && !reducedMotion() ? 'smooth' : 'instant' });
    },
  );

  createEffect(
    () => notice(),
    (current) => {
      if (!current) return;
      const timer = setTimeout(() => setNotice(undefined), 7000);
      return () => clearTimeout(timer);
    },
  );

  onSettled(() => () => {
    clearTimeout(hoverTimer);
    const key = results()?.key;
    if (key) rememberScroll(key, top);
  });

  const hover = (event: PointerEvent) => {
    const card = cardOf(event.target);
    if (!card || card === hoveredCard) return;
    clearTimeout(hoverTimer);
    hoveredCard = card;
    hoverTimer = setTimeout(
      () => prefetchProject(card.dataset.platform as SourceId, card.dataset.project as string),
      250,
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

  const hits = (): ResourceProject[] => results()?.hits ?? [];

  return (
    <section data-vesta="browse-results" aria-label={t('browse.results-label')}>
      <div data-vesta="browse-results-head">
        <span data-vesta="browse-count" role="status">
          <Show when={results()}>{t('browse.results-count', { count: total() })}</Show>
        </span>
        <label data-vesta="browse-page-size">
          <span>{t('browse.per-page')}</span>
          <Select
            size="sm"
            aria-label={t('browse.per-page')}
            options={sizeOptions}
            value={String(pageSize())}
            onChange={(value) => setPageSize(Number(value))}
          />
        </label>
      </div>
      <div
        data-vesta="browse-pane"
        ref={(element: HTMLDivElement) => (pane = element)}
        onScroll={(event) => (top = event.currentTarget.scrollTop)}
      >
        <Show when={pending()}>
          <div data-vesta="browse-progress">
            <Progress size="sm" aria-label={t('browse.loading')} />
          </div>
        </Show>
        <Show when={notice()}>
          {(current) => (
            <p data-vesta="browse-notice" data-tone={current().tone} role="status">
              <span>{current().text}</span>
              <button
                type="button"
                data-vesta="browse-notice-close"
                aria-label={t('browse.dismiss')}
                onClick={() => setNotice(undefined)}
              >
                <Icon name="icons/actions/close" size={10} />
              </button>
            </p>
          )}
        </Show>
        <Show when={warning()}>
          <p data-vesta="browse-warning" role="status">
            <Icon name="icons/controls/warning" size={12} />
            {t('browse.cached-warning')}
          </p>
        </Show>
        <Switch>
          <Match when={failure()}>
            {(message) => (
              <div data-vesta="browse-error" role="alert">
                <Icon name="icons/status/error" size={20} />
                <strong>{t('browse.error-title')}</strong>
                <p>{message()}</p>
                <Button size="sm" onClick={() => void retry()}>
                  {t('browse.retry')}
                </Button>
              </div>
            )}
          </Match>
          <Match when={!results()}>
            <Skeletons />
          </Match>
          <Match when={results() && !hits().length}>
            <EmptyState
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
              <For each={hits()} keyed={(project) => `${project.source}:${project.id}`}>
                {(project, index) => <ResultCard project={project} index={index} enter={enter} />}
              </For>
            </div>
            <Show when={pages() > 1}>
              <nav data-vesta="browse-pages" aria-label={t('browse.pages-label')}>
                <Pagination
                  count={pages()}
                  page={page()}
                  onPageChange={setPage}
                  previousLabel={t('browse.previous')}
                  nextLabel={t('browse.next')}
                  aria-label={t('browse.pages-label')}
                />
              </nav>
            </Show>
          </Match>
        </Switch>
      </div>
    </section>
  );
}
