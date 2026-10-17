import { flush, onSettled } from 'solid-js';
import { setting } from '../features/settings/config';
import { canGoBack, navigate, parseRoute, route } from './router';

let active: ViewTransition | undefined;
let pending: Promise<void> | undefined;

const reducedMotion = () =>
  setting('reduced_motion') ||
  (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Wait for Solid's route update, including any held render, before the new snapshot. */
async function renderRoute(commit: () => void | Promise<void>) {
  await commit();
  await new Promise<void>((resolve) => {
    onSettled(() => resolve());
    flush();
  });
}

/** Names belong to this snapshot pair, never to the resting page. */
async function runTransition(commit: () => void | Promise<void>, instanceId?: string, animate = true) {
  if (!animate || typeof document === 'undefined' || !document.startViewTransition || reducedMotion()) {
    await renderRoute(commit);
    return;
  }

  const named = new Map<HTMLElement, string>();
  const name = (element: HTMLElement | null, value: string) => {
    if (!element || named.has(element)) return;
    named.set(element, element.style.viewTransitionName);
    element.style.viewTransitionName = value;
  };
  const nameInstance = () => {
    if (!instanceId || route().page !== 'library') return;
    const kind = route().section ? 'instance-header' : 'instance-card';
    if (route().section && route().section !== instanceId) return;
    const element = [...document.querySelectorAll<HTMLElement>(`[data-vesta="${kind}"]`)].find(
      (element) => element.dataset.instanceId === instanceId,
    );
    name(element ?? null, 'instance-art');
  };
  const cleanup = () => {
    for (const [element, previous] of named) element.style.viewTransitionName = previous;
  };

  try {
    name(document.querySelector('[data-vesta="titlebar"]'), 'titlebar');
    name(document.querySelector('[data-vesta="rail"]'), 'rail');
    nameInstance();
    const transition = document.startViewTransition(async () => {
      await renderRoute(commit);
      nameInstance();
    });
    active = transition;
    // A skipped/unsupported snapshot can reject ready even though the route committed.
    void transition.ready.catch(() => {});
    await transition.finished;
  } finally {
    active = undefined;
    cleanup();
  }
}

/** Finish an interrupted snapshot pair before assigning names for the next one. */
function transition(commit: () => void | Promise<void>, instanceId?: string, animate = true) {
  active?.skipTransition();
  const run = () => runTransition(commit, instanceId, animate);
  const result = pending ? pending.then(run) : run();
  const settled = result.catch((error) => console.warn('Route transition failed', error));
  pending = settled;
  void settled.then(() => {
    if (pending === settled) pending = undefined;
  });
}

export function transitionTo(to: string, instanceId?: string) {
  if (typeof location !== 'undefined' && location.hash.slice(1) === to) return;
  const current = route();
  const next = parseRoute(to);
  const sameInstance =
    current.page === 'library' && next.page === 'library' && !!current.section && current.section === next.section;
  const sharedId =
    instanceId ??
    (current.page === 'library' ? current.section : undefined) ??
    (next.page === 'library' ? next.section : undefined);
  transition(() => navigate(to), sharedId, !sameInstance);
}

/** Back stays inside the snapshot callback until the router has received popstate. */
export function goBack(fallback: string, instanceId?: string) {
  const current = route();
  // Installation Back follows the parent flow, rather than previous providers.
  if (current.page === 'create') return transitionTo(current.section === 'import' ? '/create' : '/library');
  if (!canGoBack()) return transitionTo(fallback, instanceId);
  transition(
    () =>
      new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
        history.back();
      }),
    instanceId ?? (current.page === 'library' ? current.section : undefined),
  );
}
