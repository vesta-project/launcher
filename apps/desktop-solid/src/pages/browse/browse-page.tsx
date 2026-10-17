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
  syncTarget,
  targetId,
} from '../../features/browse/browse-store';
import { findInstance } from '../../features/instances/catalog';
import { InstancePickerDialog } from './instance-picker-dialog';
import { WorldPickerDialog } from './world-picker-dialog';
import { ProjectPlaceholder } from './project-placeholder';
import { Results } from './results';
import { SearchField, searchInput } from './search-field';
import { Toolbar } from './toolbar';
import './browse.css';

/** `/` focuses the search field unless the user is already typing somewhere. */
function useSearchShortcut() {
  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const active = event.target instanceof Element ? event.target : null;
      if (active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
      searchInput.element?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
}

function Browser() {
  const key = createMemo(() => queryKey(query()), { name: 'browseQueryKey' });
  useSearchShortcut();

  // The route owns the target instance; the store follows it. The instance catalogue can load
  // after the route does, so the lookup is part of what this tracks.
  createEffect(
    () => ({ id: route().section === 'for' ? route().detail : undefined, ready: !!findInstance(route().detail) }),
    ({ id }) => untrack(() => syncTarget(id)),
  );
  createEffect(
    () => targetId(),
    () => void refreshInstalled(),
  );
  createEffect(
    () => source(),
    (id) => ensureCategories(id),
  );
  // Reading the query at apply time is the point: it is the latest committed state.
  createEffect(key, () => void loadResults(untrack(query)));

  onSettled(() => listenForInstalls());

  return (
    <Board fixed>
      <div data-vesta="browse">
        <Toolbar />
        <SearchField />
        <Results />
      </div>
      <InstancePickerDialog />
      <WorldPickerDialog />
    </Board>
  );
}

export function BrowsePage() {
  return (
    <Show when={route().section === 'project'} fallback={<Browser />}>
      <ProjectPlaceholder platform={route().detail} id={route().item} />
    </Show>
  );
}
