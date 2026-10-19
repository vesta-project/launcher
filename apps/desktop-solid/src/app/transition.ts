import { flush } from 'solid-js';
import { setting } from '../features/settings/config';
import { canGoBack, navigate, parseRoute, previousPath, route } from './router';

let ticket = 0;
let active: { transition: ViewTransition; cleanup: () => void } | undefined;
const reducedMotion = () => setting('reduced_motion') ||
  (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

function stopTransition() {
  active?.transition.skipTransition();
  active?.cleanup();
  active = undefined;
}

/** Ordinary navigation commits immediately. Only an explicit card-to-header move takes a snapshot. */
export function transitionTo(to: string, instanceId?: string, options?: { replace?: boolean }) {
  const current = route();
  const next = parseRoute(to);
  const fromHash = typeof location === 'undefined' ? '' : location.hash;
  const mine = ++ticket;
  stopTransition();
  const morph = instanceId && current.page === 'library' && !current.section
    && next.page === 'library' && next.section === instanceId;
  if (!morph || typeof document === 'undefined' || !document.startViewTransition || reducedMotion()) {
    navigate(to, options);
    return;
  }
  const named = new Map<HTMLElement, string>();
  const name = (element: HTMLElement | null, value: string) => {
    if (!element || named.has(element)) return;
    named.set(element, element.style.viewTransitionName);
    element.style.viewTransitionName = value;
  };
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const [element, previous] of named) element.style.viewTransitionName = previous;
  };
  const instanceElement = (kind: string) => [...document.querySelectorAll<HTMLElement>(`[data-vesta="${kind}"]`)]
    .find((element) => element.dataset.instanceId === instanceId) ?? null;
  name(document.querySelector('[data-vesta="titlebar"]'), 'titlebar');
  name(document.querySelector('[data-vesta="rail"]'), 'rail');
  name(instanceElement('instance-card'), 'instance-art');
  try {
    const transition = document.startViewTransition(() => {
      // A later navigation wins even if this snapshot callback has not run yet.
      if (mine !== ticket || location.hash !== fromHash) return;
      navigate(to, options);
      flush();
      name(instanceElement('instance-header'), 'instance-art');
    });
    const run = { transition, cleanup };
    active = run;
    void transition.ready.catch(() => undefined);
    void transition.finished.catch(() => undefined).finally(() => {
      cleanup();
      if (active === run) active = undefined;
    });
  } catch {
    cleanup();
    if (mine === ticket) navigate(to, options);
  }
}

/** Back follows actual tab/page history, without snapshots, settle timers or a transition queue. */
export function goBack(fallback: string, _instanceId?: string) {
  ++ticket;
  stopTransition();
  const current = route();
  // Import Back remains the install-flow parent, rather than a previously selected provider.
  if (current.page === 'create' && current.section === 'import' && previousPath() !== '/create') {
    navigate('/create', { replace: true });
    return;
  }
  if (canGoBack()) history.back();
  else navigate(fallback, { replace: true });
}
