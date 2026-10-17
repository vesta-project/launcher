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

export function versionFilterFor(key: string): VersionFilter {
  const current = state();
  return current?.key === key ? current.filter : initial;
}

export function updateVersionFilter(key: string, patch: Partial<VersionFilter>) {
  const filter = untrack(() => versionFilterFor(key));
  setState({ key, filter: { ...filter, ...patch } });
}

export function resetVersionFilter(key: string) {
  const fits = untrack(() => versionFilterFor(key)).fits;
  setState({ key, filter: { ...emptyVersionFilter, fits } });
}


/** Entering another project retires the previous project's filters. */
export function activateVersionFilter(key: string) {
  if (untrack(state)?.key !== key) setState({ key, filter: initial });
}
