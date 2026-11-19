import { createEffect, createMemo, onSettled, Show, untrack } from 'solid-js';
import { route } from '../../app/router';
import { Board } from '../../components/board';
import { queryKey } from '../../features/browse/browse-model';
import {
  ensureCategories,
  listenForInstalls,
  loadResults,
  query,
  refreshInstalled,
  source,
  syncServerTarget,
  syncTarget,
  targetId,
} from '../../features/browse/browse-store';
import { findInstance } from '../../features/instances/catalog';
import { InstancePickerDialog } from './instance-picker-dialog';
import { WorldPickerDialog } from './world-picker-dialog';
import { ProjectPage } from './project/project-page';
import { ServerTargetSync } from './server-target-sync';
import { Results } from './results';
import { SearchField, searchInput } from './search-field';
import { Toolbar } from './toolbar';
import './browse.css';

const decodeSegment = (value: string | undefined) => {
  try {
    return value && decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** `/` focuses the search field unless the user is already typing somewhere. */
function useSearchShortcut(enabled: () => boolean) {
  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabled() || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const active = event.target instanceof Element ? event.target : null;
      if (active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
      searchInput.element?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
}

/** The list stays mounted under a project page or another page (`active` false), so returning shows it as it was. */
function Browser(props: { active: () => boolean }) {
  const key = createMemo(() => queryKey(query()), { name: 'browseQueryKey' });
  useSearchShortcut(props.active);

  // The route owns the target (an instance under /for, a server under /server); the store
  // follows it. The instance catalogue can load after the route does, so the lookup is part of
  // what this tracks. A project page chooses its target in place, so its route is not applied.
  createEffect(
    () => ({
      active: props.active(),
      instance: route().section === 'for' ? route().detail : undefined,
      server: route().section === 'server' ? decodeSegment(route().detail) : undefined,
      ready: !!findInstance(route().detail),
    }),
    ({ active, instance, server }) =>
      untrack(() => {
        if (!active) return;
        if (server) return syncServerTarget(server);
        syncServerTarget(undefined);
        syncTarget(instance);
      }),
  );
  createEffect(
    () => targetId(),
    () => void refreshInstalled(),
  );
  createEffect(
    () => source(),
    (id) => ensureCategories(id),
  );
  // The store publishes cached data or a loading state immediately. The request itself is async.
  createEffect(key, () => void loadResults(untrack(query)));

  onSettled(() => listenForInstalls());

  return (
    <Board fixed>
      <div data-vesta="browse">
        <Toolbar />
        <SearchField />
        <Results active={props.active} />
      </div>
    </Board>
  );
}

/** Stays mounted while other pages show (see the shell); `shown` is whether Browse is on screen. */
export function BrowsePage() {
  const shown = () => route().page === 'browse';
  const onProject = () => shown() && route().section === 'project';
  return (
    <>
      <Show when={onProject()}>
        <ProjectPage />
      </Show>
      <div style={{ display: onProject() ? 'none' : 'contents' }}>
        <Browser active={() => shown() && !onProject()} />
      </div>
      {/* Both views install through the same choosers. */}
      <InstancePickerDialog />
      <WorldPickerDialog />
      <Show when={shown()}>
        <ServerTargetSync />
      </Show>
    </>
  );
}
