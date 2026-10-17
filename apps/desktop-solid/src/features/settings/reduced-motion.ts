import { createEffect, onCleanup } from 'solid-js';
import { setting } from './config';
/** A root preference independent of theme selection and the OS motion setting. */
export function useReducedMotion() {
  if (typeof document === 'undefined') return;
  createEffect(() => setting('reduced_motion'), (reduced) => {
    document.documentElement.toggleAttribute('data-vesta-reduced-motion', reduced);
  });
  onCleanup(() => document.documentElement.removeAttribute('data-vesta-reduced-motion'));
}
