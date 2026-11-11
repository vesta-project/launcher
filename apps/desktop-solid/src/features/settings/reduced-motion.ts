import { createEffect, createSignal, onCleanup, onSettled } from 'solid-js';
import { setting } from './config';

const query = () => typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-reduced-motion: reduce)');
const [systemReduced, setSystemReduced] = createSignal(query()?.matches ?? false, { name: 'systemReducedMotion' });

/** One effective preference for CSS and JavaScript motion. The app can reduce motion further. */
export const reducedMotion = () => setting('reduced_motion') || systemReduced();

/** App-owned subscription, including changes to the OS preference while the app is open. */
export function useReducedMotion() {
  if (typeof document === 'undefined') return;
  onSettled(() => {
    const media = query();
    if (!media) return;
    const changed = () => setSystemReduced(media.matches);
    media.addEventListener('change', changed);
    changed();
    return () => media.removeEventListener('change', changed);
  });
  createEffect(reducedMotion, (reduced) => {
    document.documentElement.toggleAttribute('data-vesta-reduced-motion', reduced);
  });
  onCleanup(() => document.documentElement.removeAttribute('data-vesta-reduced-motion'));
}
