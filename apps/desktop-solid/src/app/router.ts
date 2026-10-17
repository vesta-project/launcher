import { createSignal } from 'solid-js';

// Hash routing: no server rewrites needed in the packaged app, and the browser's
// own history gives back/forward for free. Guarded so the static prerender can import it.
const hasWindow = typeof window !== 'undefined';

const read = () => (hasWindow ? location.hash.replace(/^#/, '') : '') || '/library';

const [path, setPath] = createSignal(read(), { name: 'route' });

// Each in-app navigation stamps its history entry with a depth, so back can tell an
// entry we pushed from the window's first page (where back would leave the app).
const depth = () => (hasWindow ? ((history.state as { vesta?: number } | null)?.vesta ?? 0) : 0);
const [historyDepth, setHistoryDepth] = createSignal(depth(), {
  name: 'historyDepth',
});

const sync = () => {
  setPath(read());
  setHistoryDepth(depth());
};
// popstate covers back/forward over entries we pushed; hashchange covers a hand-edited hash.
if (hasWindow) {
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
}

/** True when history.back() returns to an earlier page of the launcher. */
export const canGoBack = () => historyDepth() > 0;

export type PageId = 'library' | 'browse' | 'create' | 'settings';

export interface Route {
  page: PageId;
  /** Second path segment: an instance id under library, or a section under settings. */
  section?: string;
  /** Third path segment: the tab of an instance. */
  detail?: string;
  /** A world being managed inside the Worlds section. */
  item?: string;
}

const pages: PageId[] = ['library', 'browse', 'create', 'settings'];

export function parseRoute(value: string): Route {
  const [page, section, detail, item] = value.split('/').filter(Boolean);
  return {
    page: pages.includes(page as PageId) ? (page as PageId) : 'library',
    section,
    detail,
    item,
  };
}

export const route = (): Route => parseRoute(path());

/**
 * Navigates immediately: the route signal updates now, not on a later browser event.
 * `replace` swaps the current entry instead of adding one, for moves between sibling views
 * (settings sections) that back should skip over.
 */
export function navigate(to: string, options?: { replace?: boolean }) {
  if (!hasWindow || location.hash.slice(1) === to) return;
  // The History API writes the entry and its depth in one step. Assigning location.hash and
  // then stamping it races WebKit's own entry bookkeeping, which left back with a dead step.
  if (options?.replace) history.replaceState({ vesta: historyDepth() }, '', `#${to}`);
  else {
    const next = historyDepth() + 1;
    history.pushState({ vesta: next }, '', `#${to}`);
    setHistoryDepth(next);
  }
  setPath(read());
}
