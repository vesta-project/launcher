import { render } from '@solidjs/web';
import { Skeleton } from '@vesta/ui';

/** Run in the fixture browser: explicit loading radii must still obey square themes. */
export async function runThemeSkeleton() {
  const host = document.createElement('div');
  document.body.append(host);
  const style = document.createElement('style');
  document.head.append(style);
  const dispose = render(() => <Skeleton width={80} height={30} radius={12} />, host);
  const skeleton = host.querySelector('[data-vesta="skeleton"]')!;
  try {
    for (const [factor, expected] of [[1, '12px'], [0, '0px']] as const) {
      style.textContent = `:root { --vesta-radius-factor: ${factor}; }`;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (getComputedStyle(skeleton).borderRadius !== expected) throw new Error(`Loading radius ignores factor ${factor}`);
    }
    style.textContent = ':root { --vesta-radius-factor: 0; } [data-vesta="skeleton"] { --skeleton-radius: 7px; }';
    if (getComputedStyle(skeleton).borderRadius !== '7px') throw new Error('Skeleton hook does not override preferred radius');
    return 'explicit skeleton radius follows theme factor and component hook';
  } finally {
    dispose(); host.remove(); style.remove();
  }
}
