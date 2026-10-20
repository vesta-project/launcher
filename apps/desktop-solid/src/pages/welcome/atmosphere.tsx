import { For, onSettled } from 'solid-js';

/** Deterministic spread, so the specks are already mid-drift on the first frame. */
const specks = Array.from({ length: 36 }, (_, i) => ({
  left: `${(i * 37 + 13) % 100}%`,
  top: `${(i * 53 + 7) % 100}%`,
  size: `${1 + ((i * 13) % 3)}px`,
  start: `${i * 47 - 80}px`,
  duration: `${(3.5 + (i % 4) * 0.8).toFixed(1)}s`,
}));

/**
 * The welcome backdrop from the old launcher: three accent-tinted orbs drifting, rising
 * specks and a soft light that follows the pointer. Purely decorative; it calms down once
 * a theme is picked so the card reads as part of the real app.
 */
export function Atmosphere(props: { calm: boolean }) {
  let light: HTMLDivElement | undefined;
  onSettled(() => {
    let frame = 0;
    let x = 50;
    let y = 50;
    const move = (event: PointerEvent) => {
      x = (event.clientX / window.innerWidth) * 100;
      y = (event.clientY / window.innerHeight) * 100;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        light?.style.setProperty('--welcome-light-x', `${x}%`);
        light?.style.setProperty('--welcome-light-y', `${y}%`);
      });
    };
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('pointermove', move);
      cancelAnimationFrame(frame);
    };
  });

  return (
    <div data-vesta="welcome-atmosphere" data-calm={props.calm ? '' : undefined} aria-hidden="true">
      <i data-vesta="welcome-orb" />
      <i data-vesta="welcome-orb" />
      <i data-vesta="welcome-orb" />
      <div data-vesta="welcome-specks">
        <For each={specks}>
          {(speck) => (
            <i
              data-vesta="welcome-speck"
              style={{
                left: speck.left,
                top: speck.top,
                width: speck.size,
                height: speck.size,
                '--welcome-speck-start': speck.start,
                'animation-duration': speck.duration,
              }}
            />
          )}
        </For>
      </div>
      <div ref={(element: HTMLDivElement) => (light = element)} data-vesta="welcome-light" />
    </div>
  );
}
