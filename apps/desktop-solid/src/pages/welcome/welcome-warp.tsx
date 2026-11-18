import { For, onSettled } from 'solid-js';
import { onboarding } from '../../features/onboarding';
import { reducedMotion } from './welcome-intro';
import './welcome-warp.css';

/** Long enough for every streak and the shell's arrival (welcome-warp.css) to finish. */
const WARP_MS = 1150;

/** Deterministic streaks all around the centre, so every exit looks the same. */
const streaks = Array.from({ length: 56 }, (_, i) => ({
  angle: `${(i * (360 / 56) + (((i * 37) % 11) - 5)).toFixed(1)}deg`,
  delay: `${120 + ((i * 53) % 9) * 24}ms`,
  length: `${14 + ((i * 29) % 18)}vmin`,
  thickness: `${1 + ((i * 7) % 3) * 0.5}px`,
}));

/**
 * The warp into the app: whatever covers it rushes past, light streaks out from the middle and
 * the shell arrives from behind. It marks the root with `data-vesta-warp` so the covering screen
 * and the shell can take part (welcome-warp.css), then calls `onDone`. Reduced motion turns it
 * into a quick crossfade. Used when leaving setup and at the end of the welcome back sequence.
 */
export function Warp(props: { onDone: () => void }) {
  onSettled(() => {
    const root = document.documentElement;
    root.dataset.vestaWarp = '';
    const timer = setTimeout(() => props.onDone(), reducedMotion() ? 120 : WARP_MS);
    return () => {
      clearTimeout(timer);
      delete root.dataset.vestaWarp;
    };
  });

  return (
    <div data-vesta="welcome-warp" aria-hidden="true">
      <i data-vesta="welcome-warp-flash" />
      <For each={streaks}>
        {(streak) => (
          <i
            data-vesta="welcome-warp-streak"
            style={{
              '--warp-angle': streak.angle,
              '--warp-delay': streak.delay,
              '--warp-length': streak.length,
              '--warp-thickness': streak.thickness,
            }}
          />
        )}
      </For>
    </div>
  );
}

/** Leaving setup, shown while `onboarding.exiting()`. */
export const WelcomeWarp = () => <Warp onDone={onboarding.endExit} />;
