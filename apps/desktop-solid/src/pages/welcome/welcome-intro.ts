import { createSignal, onSettled } from 'solid-js';
import { setting } from '../../features/settings/config';

/**
 * The first-load intro on the splash: the V kindles from its point, the rest of the name is
 * drawn in, and the logo settles from the middle of the window into its place on the splash
 * while everything else fades in. The logo is laid out in its final spot from the first frame;
 * only a transform carries it there, so nothing shifts. CSS lives in welcome-intro.css.
 */
export type IntroPhase = 'playing' | 'settled';

/** Same rule as the app's view transitions: the launcher setting or the OS preference. */
export const reducedMotion = () =>
  setting('reduced_motion') ||
  (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** One intro per visit to onboarding: the first claim gets it, later splash mounts do not. */
export function createIntroClaim(available: boolean) {
  let left = available;
  return () => {
    const claimed = left;
    left = false;
    return claimed;
  };
}

/** Skipping fast-forwards rather than cutting, so the logo still glides home. */
const SKIP_RATE = 8;
const isIntro = (animation: Animation) =>
  animation instanceof CSSAnimation && animation.animationName.startsWith('welcome-intro');

export function createWelcomeIntro(play: boolean) {
  const [phase, setPhase] = createSignal<IntroPhase | undefined>(play ? 'playing' : undefined, {
    name: 'welcomeIntroPhase',
  });
  let logo: HTMLElement | undefined;

  onSettled(() => {
    const root = logo?.closest<HTMLElement>('[data-vesta="welcome"]');
    if (!play || !logo || !root) return;
    // Start the logo at the window's centre; the settle animation carries it back to (0, 0).
    const rect = logo.getBoundingClientRect();
    logo.style.setProperty('--welcome-intro-dx', `${innerWidth / 2 - (rect.left + rect.width / 2)}px`);
    logo.style.setProperty('--welcome-intro-dy', `${innerHeight / 2 - (rect.top + rect.height / 2)}px`);

    const animations = root.getAnimations({ subtree: true }).filter(isIntro);
    let done = false;
    const skip = (event: Event) => {
      if (done) return;
      event.preventDefault();
      event.stopPropagation();
      for (const animation of animations) animation.updatePlaybackRate(SKIP_RATE);
    };
    const stop = () => {
      done = true;
      clearTimeout(fallback);
      window.removeEventListener('keydown', skip, true);
      window.removeEventListener('pointerdown', skip, true);
    };
    const finish = () => {
      if (done) return;
      stop();
      setPhase('settled');
    };
    // If the animations never run (hidden window, stripped styles), do not leave the page hidden.
    const fallback = setTimeout(finish, 4000);
    window.addEventListener('keydown', skip, true);
    window.addEventListener('pointerdown', skip, true);
    void Promise.all(animations.map((animation) => animation.finished)).then(finish, finish);
    return stop;
  });

  return {
    phase,
    ref: (element: HTMLElement) => {
      logo = element;
    },
  };
}
