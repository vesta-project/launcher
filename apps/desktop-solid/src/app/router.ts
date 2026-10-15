import { createSignal } from 'solid-js';

// Hash routing: no server rewrites needed in the packaged app, and the browser's
// own history gives back/forward for free. Guarded so the static prerender can import it.
const hasWindow = typeof window !== 'undefined';

const read = () => (hasWindow ? location.hash.replace(/^#/, '') : '') || '/library';

const [path, setPath] = createSignal(read(), { name: 'route' });

if (hasWindow) window.addEventListener('hashchange', () => setPath(read()));

export type PageId = 'library' | 'browse' | 'create' | 'settings';

export interface Route {
  page: PageId;
  /** Second path segment: an instance id under library, or a section under settings. */
  section?: string;
}

const pages: PageId[] = ['library', 'browse', 'create', 'settings'];

export function parseRoute(value: string): Route {
  const [page, section] = value.split('/').filter(Boolean);
  return { page: pages.includes(page as PageId) ? (page as PageId) : 'library', section };
}

export const route = (): Route => parseRoute(path());

export function navigate(to: string) {
  if (hasWindow && location.hash.slice(1) !== to) location.hash = to;
}
