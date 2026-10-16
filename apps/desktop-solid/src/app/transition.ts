import { createSignal, flush } from 'solid-js';
import { canGoBack, navigate, parseRoute, route } from './router';

const NAME = 'instance-art';

/** Which instance's card currently carries the shared view-transition name. */
const [sharedInstance, setSharedInstance] = createSignal<string | undefined>(undefined, { name: 'sharedInstance' });

/** `view-transition-name` for an instance's card: set only while a transition runs. */
export const cardTransitionName = (id: string) => (sharedInstance() === id ? NAME : undefined);

export const instanceArtTransitionName = NAME;

/**
 * Navigate with a view transition. When `instanceId` is given, that instance's card
 * and the instance page header share a name, so the art morphs between them instead of
 * cross-fading. Falls back to a plain navigation without the API or with reduced motion.
 */
export function transitionTo(to: string, instanceId?: string) {
  if (typeof location !== 'undefined' && location.hash.slice(1) === to) return;
  const current = route();
  const next = parseRoute(to);
  // An instance's identity stays on screen while navigating its own sections.
  if (current.page === 'library' && next.page === 'library' && current.section && current.section === next.section) {
    return navigate(to);
  }
  const supported = typeof document !== 'undefined' && 'startViewTransition' in document;
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!supported || reduced) return navigate(to);

  setSharedInstance(instanceId);
  flush(); // the card gets its name before the old state is captured
  const transition = document.startViewTransition(() => {
    navigate(to);
    flush(); // the new page is in the DOM before the new state is captured
  });
  void transition.finished.finally(() => setSharedInstance(undefined));
}

/**
 * Back through launcher history (tabs included), or to `fallback` when there is none.
 * history.back() lands asynchronously, so the transition waits for the hash to change.
 */
export function goBack(fallback: string, instanceId?: string) {
  if (!canGoBack()) return transitionTo(fallback, instanceId);
  const supported = typeof document !== 'undefined' && 'startViewTransition' in document;
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!supported || reduced) return history.back();

  setSharedInstance(instanceId);
  flush();
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        window.addEventListener('hashchange', () => (flush(), resolve()), {
          once: true,
        });
        history.back();
      }),
  );
  void transition.finished.finally(() => setSharedInstance(undefined));
}
