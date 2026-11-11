import { createEffect } from 'solid-js';
import { reducedMotion } from '../../features/settings/reduced-motion';

/** Decorative pointer tracking exists only while motion is allowed. */
export function useWelcomeLight(target: () => HTMLElement | undefined) {
  createEffect(reducedMotion, (reduced) => {
    const light = target();
    if (reduced) {
      light?.style.removeProperty('--welcome-light-x');
      light?.style.removeProperty('--welcome-light-y');
      return;
    }
    let frame: number | undefined;
    let x = 50;
    let y = 50;
    const move = (event: PointerEvent) => {
      x = (event.clientX / window.innerWidth) * 100;
      y = (event.clientY / window.innerHeight) * 100;
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        light?.style.setProperty('--welcome-light-x', `${x}%`);
        light?.style.setProperty('--welcome-light-y', `${y}%`);
      });
    };
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('pointermove', move);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, { name: 'welcomePointerLight' });
}
