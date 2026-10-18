import { Badge, Button, Combobox, Pagination, SegmentedControl, Select, Skeleton, TextField } from '@vesta/ui';
import { createEffect, createMemo, For, Match, onSettled, Show, Switch, untrack } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import {
  filterVersions,
  formatCompact,
  loaderLabel,
  minecraftVersionsOf,
  pageSizes,
  projectKey,
  summarizeGameVersions,
  versionFacets,
  versionFit,
  versionPath,
  type ChannelFilter,
  type ResourceProject,
  type ResourceVersion,
} from '../../../features/browse/browse-model';
import { prefetchVersionDetails } from '../../../features/browse/browse-projects';
import { installed, target } from '../../../features/browse/browse-store';
import {
  resetVersionFilter,
  setVersionPage,
  setVersionPageSize,
  updateVersionFilter,
  versionFilterFor,
  versionPageFor,
  versionPageSize,
} from '../../../features/browse/version-filter';
import { formatNumber, t } from '../../../localization';
import { InstallButton } from '../install-button';
import { runInstall } from '../install-actions';
import type { ProjectData } from './project-data';
import { ChannelBadge, formatDay, LoaderMarks, sameAction, versionAction } from './project-shared';

const sizeOptions = pageSizes.map((size) => ({ value: String(size), label: String(size) }));
const skeletonRows = Array.from({ length: 8 }, (_, index) => index);

/** Opens a version page; modified clicks are left alone like any link. */
export function openVersion(event: MouseEvent, path: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  transitionTo(path);
}

/**
 * One version on one line, in the release-list style of an instance's Versions tab: name and
 * channel, Minecraft versions (amber when they miss the target), loaders, date, downloads, and
 * an Install for exactly this version that appears on hover or focus. The row opens the version.
 */
function VersionRow(props: { project: ResourceProject; version: ResourceVersion }) {
  const path = () => versionPath(props.project.source, props.project.id, props.version.id);
  const games = createMemo(() => minecraftVersionsOf(props.version.game_versions), { name: 'projectVersionGames' });
  const action = createMemo(() => versionAction(props.project, props.version), {
    name: 'projectVersionAction',
    equals: sameAction,
  });
  const isInstalled = () =>
    installed().get(projectKey(props.project.source, props.project.id))?.remote_version_id === props.version.id;
  const differs = () => {
    const info = target();
    return (
      !!info &&
      props.project.resource_type !== 'modpack' &&
      versionFit(props.version, info, props.project.resource_type, props.project.source).kind !== 'fits'
    );
  };
  return (
    <div
      data-vesta="project-version"
      data-installed={isInstalled() ? '' : undefined}
      data-version-id={props.version.id}
    >
      <span data-vesta="project-version-name">
        <a
          data-vesta="project-version-link"
          href={`#${path()}`}
          onClick={(event) => {
            openVersion(event, path());
          }}
        >
          {props.version.version_number}
        </a>
        <ChannelBadge channel={props.version.release_type} />
        <Show when={isInstalled()}>
          <Badge size="sm" tone="accent" variant="soft">
            {t('versions.installed')}
          </Badge>
        </Show>
      </span>
      <span
        data-vesta="project-version-game"
        data-differs={differs() ? '' : undefined}
        data-tip={games().length > 2 ? games().join(', ') : undefined}
      >
        {summarizeGameVersions(games())}
      </span>
      <span data-vesta="project-version-loaders">
        <LoaderMarks loaders={props.version.loaders} />
      </span>
      <time data-vesta="project-version-date" datetime={props.version.published_at ?? undefined}>
        {formatDay(props.version.published_at)}
      </time>
      <span data-vesta="project-version-downloads">
        <Show when={typeof props.version.download_count === 'number'}>
          <Icon name="icons/actions/download" size={11} />
          {formatCompact(props.version.download_count as number)}
        </Show>
      </span>
      <span data-vesta="project-version-action">
        <InstallButton
          state={() => action().state}
          disabled={action().waiting}
          hint={action().replaces && target() ? t('browse.install-replaces', { title: target()!.name }) : undefined}
          targetName={() => target()?.name}
          onRun={() => void runInstall(props.project, props.project.resource_type, target(), props.version)}
        />
      </span>
    </div>
  );
}

/**
 * The Versions tab: a filter bar in the chrome (search, Minecraft version, loader, channel and
 * "fits the target"), then one page of the list with pages and page size at its foot. Filters
 * and the page are kept for the project, so a version page can step through the same list and
 * coming back finds it unchanged; changing a filter returns to page 1.
 */
export function ProjectVersions(props: { data: ProjectData; project: ResourceProject }) {
  const key = untrack(() => props.data.key);
  const filter = () => versionFilterFor(key);
  let scroller: HTMLDivElement | undefined;
  const all = () => props.data.versions() ?? [];
  const facets = createMemo(() => versionFacets(all()), { name: 'projectVersionFacets' });
  const canFit = () => !!target() && props.project.resource_type !== 'modpack';
  const shown = createMemo(
    () =>
      filterVersions(
        all(),
        { ...filter(), fits: filter().fits && canFit() },
        { target: target(), type: props.project.resource_type, source: props.project.source },
      ),
    { name: 'projectVersionsShown' },
  );
  const pages = createMemo(() => Math.max(1, Math.ceil(shown().length / versionPageSize())), {
    name: 'projectVersionPages',
  });
  // A stored page past the end (the list shrank) shows the last page instead of nothing.
  const page = () => Math.min(versionPageFor(key), pages());
  const pageRows = createMemo(
    () => {
      const size = versionPageSize();
      const start = (page() - 1) * size;
      return shown().slice(start, start + size);
    },
    { name: 'projectVersionPageRows' },
  );
  // A new page starts at its top.
  createEffect(
    () => page(),
    (_, previous) => {
      if (previous !== undefined) scroller?.scrollTo({ top: 0 });
    },
  );
  const filtered = () => {
    const current = filter();
    return !!(current.text || current.gameVersion || current.loader || current.channel !== 'all' || (current.fits && canFit()));
  };
  const gameOptions = createMemo(
    () => [
      { value: '', label: t('browse.any-version') },
      ...facets().gameVersions.map((value) => ({ value, label: value })),
    ],
    { name: 'projectVersionGameOptions' },
  );
  const loaderOptions = createMemo(
    () => [
      { value: '', label: t('browse.any-loader') },
      ...facets().loaders.map((value) => ({ value, label: loaderLabel(value) })),
    ],
    { name: 'projectVersionLoaderOptions' },
  );
  const channelOptions = createMemo(
    () => [
      { value: 'all', label: t('browse.channel-all') },
      { value: 'release', label: t('linking.channel-release') },
      { value: 'beta', label: t('linking.channel-beta') },
      { value: 'alpha', label: t('linking.channel-alpha') },
    ],
    { name: 'projectVersionChannelOptions' },
  );

  // Hovering a row for a moment loads its details, so opening it shows the changelog at once.
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hovered: string | undefined;
  const rowOf = (node: EventTarget | null) =>
    (node as Element | null)?.closest?.<HTMLElement>('[data-vesta="project-version"]') ?? null;
  const prefetch = (id: string | undefined) => {
    if (id) prefetchVersionDetails(props.project.source, props.project.id, id);
  };
  const hover = (event: PointerEvent) => {
    const id = rowOf(event.target)?.dataset.versionId;
    if (id === hovered) return;
    hovered = id;
    clearTimeout(hoverTimer);
    if (id) hoverTimer = setTimeout(() => prefetch(id), 180);
  };
  onSettled(() => () => clearTimeout(hoverTimer));

  return (
    <div data-vesta="project-versions">
      <div data-vesta="project-toolbar">
        <TextField
          size="sm"
          class="project-versions-search"
          aria-label={t('browse.search-versions')}
          placeholder={t('browse.search-versions')}
          icon={<Icon name="icons/content/search" size={14} />}
          value={filter().text}
          onChange={(text) => updateVersionFilter(key, { text })}
        />
        <Combobox
          size="sm"
          class="project-versions-game"
          aria-label={t('browse.section-version')}
          placeholder={t('browse.any-version')}
          options={gameOptions()}
          maxOptions={120}
          value={filter().gameVersion ?? ''}
          onChange={(value) => updateVersionFilter(key, { gameVersion: value || null })}
        />
        <Show when={facets().loaders.length > 1}>
          <Select
            size="sm"
            class="project-versions-loader"
            aria-label={t('browse.section-loader')}
            options={loaderOptions()}
            value={filter().loader ?? ''}
            onChange={(value) => updateVersionFilter(key, { loader: value || null })}
          />
        </Show>
        <SegmentedControl
          size="sm"
          aria-label={t('versions.release-type')}
          options={channelOptions()}
          value={filter().channel}
          onChange={(value) => updateVersionFilter(key, { channel: value as ChannelFilter })}
        />
        <Show when={canFit()}>
          <button
            type="button"
            data-vesta="browse-toggle"
            aria-pressed={filter().fits ? 'true' : 'false'}
            data-tip={t('browse.fits-hint', { title: target()?.name ?? '' })}
            onClick={() => updateVersionFilter(key, { fits: !filter().fits })}
          >
            <Icon name="icons/controls/check" size={12} />
            <span data-vesta="browse-toggle-label">{t('browse.fits-target', { title: target()?.name ?? '' })}</span>
          </button>
        </Show>
        <span data-vesta="project-toolbar-count">
          <Show when={props.data.versions()}>
            {filtered()
              ? t('browse.versions-shown', { found: formatNumber(shown().length), count: formatNumber(all().length) })
              : t('browse.versions-total', { count: all().length })}
          </Show>
        </span>
      </div>

      <div
        data-vesta="project-versions-pane"
        tabindex={-1}
        ref={(element) => (scroller = element)}
        onPointerOver={hover}
        onFocusIn={(event) => prefetch(rowOf(event.target)?.dataset.versionId)}
      >
        <Switch>
          <Match when={props.data.versionsError() && !props.data.versions()}>
            <div data-vesta="project-state" role="alert">
              <Icon name="icons/status/error" size={20} />
              <strong>{t('browse.versions-failed')}</strong>
              <p>{props.data.versionsError()}</p>
              <Button size="sm" onClick={() => props.data.retry()}>
                {t('browse.retry')}
              </Button>
            </div>
          </Match>
          <Match when={!props.data.versions()}>
            <div data-vesta="project-version-list" aria-busy="true" aria-label={t('browse.loading-versions')}>
              <For each={skeletonRows}>
                {() => (
                  <div data-vesta="project-version" data-skeleton="">
                    <Skeleton width={120} height={12} />
                    <Skeleton width={90} height={12} />
                  </div>
                )}
              </For>
            </div>
          </Match>
          <Match when={!all().length}>
            <EmptyState icon="icons/content/layers" title={t('browse.versions-none')} />
          </Match>
          <Match when={!shown().length}>
            <EmptyState icon="icons/content/filter" title={t('browse.versions-no-match')}>
              <Button size="sm" onClick={() => resetVersionFilter(key)}>
                {t('browse.reset-filters')}
              </Button>
            </EmptyState>
          </Match>
          <Match when={true}>
            <div data-vesta="project-version-list">
              <div data-vesta="project-version-head" aria-hidden="true">
                <span>{t('browse.column-version')}</span>
                <span>{t('browse.section-version')}</span>
                <span>{t('browse.section-loader')}</span>
                <span>{t('browse.column-published')}</span>
                <span>{t('browse.column-downloads')}</span>
                <span />
              </div>
              <For each={pageRows()} keyed={(version) => version.id}>
                {(version) => <VersionRow project={props.project} version={version()} />}
              </For>
            </div>
            <footer data-vesta="project-versions-pages">
              <Show when={pages() > 1}>
                <Pagination
                  count={pages()}
                  page={page()}
                  onPageChange={(next) => setVersionPage(key, next)}
                  previousLabel={t('browse.previous')}
                  nextLabel={t('browse.next')}
                  aria-label={t('browse.pages-label')}
                />
              </Show>
              <label data-vesta="project-versions-page-size">
                <span data-vesta="project-versions-page-size-label">{t('browse.per-page')}</span>
                <Select
                  size="sm"
                  aria-label={t('browse.per-page')}
                  options={sizeOptions}
                  value={String(versionPageSize())}
                  onChange={(value) => setVersionPageSize(key, Number(value))}
                />
              </label>
            </footer>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
