import { createSignal, untrack } from 'solid-js';
import { emptyVersionFilter, type VersionFilter } from './browse-model';

/**
 * The project page's version filters. Module state, so they survive a visit to a version page
 * (which also reads them for previous/next) and reset when another project is opened.
 * `fits` starts on: with a target instance, the list opens on what can go into it.
 */
const initial: VersionFilter = { ...emptyVersionFilter, fits: true };
const [state, setState] = createSignal<{ key: string; filter: VersionFilter } | undefined>(undefined, {
  name: 'browseVersionFilter',
});

/** The shown page of the Versions list, per project like the filters; any filter change returns to page 1. */
const [pageState, setPageState] = createSignal<{ key: string; page: number } | undefined>(undefined, {
  name: 'browseVersionPage',
});
/** Rows per page, shared by every project (a reading preference, not a per-project filter). */
const [pageSize, setPageSize] = createSignal(50, { name: 'browseVersionPageSize' });

export function versionPageFor(key: string): number {
  const current = pageState();
  return current?.key === key ? current.page : 1;
}

export function setVersionPage(key: string, page: number) {
  setPageState({ key, page: Math.max(1, Math.floor(page)) });
}

export const versionPageSize = pageSize;

export function setVersionPageSize(key: string, size: number) {
  setPageSize(size);
  setPageState({ key, page: 1 });
}

export function versionFilterFor(key: string): VersionFilter {
  const current = state();
  return current?.key === key ? current.filter : initial;
}

export function updateVersionFilter(key: string, patch: Partial<VersionFilter>) {
  const filter = untrack(() => versionFilterFor(key));
  setState({ key, filter: { ...filter, ...patch } });
  setPageState({ key, page: 1 });
}

export function resetVersionFilter(key: string) {
  const fits = untrack(() => versionFilterFor(key)).fits;
  setState({ key, filter: { ...emptyVersionFilter, fits } });
  setPageState({ key, page: 1 });
}

/** Entering another project retires the previous project's filters. */
export function activateVersionFilter(key: string) {
  if (untrack(state)?.key !== key) setState({ key, filter: initial });
  if (untrack(pageState)?.key !== key) setPageState({ key, page: 1 });
}
