import { Show } from 'solid-js';

/** The full Vesta wordmark, cropped from the old launcher's public/vesta-full.png. */
const LOGO_SRC = '/assets/branding/vesta-full.png';

/**
 * The wordmark as one image. For the intro, the V is drawn a second time in its own layer
 * (clipped to the V, while the main image hides it) so the two parts can arrive separately;
 * at rest the two layers line up exactly into the one logo.
 */
export function WelcomeLogo(props: { intro: boolean; ref?: (element: HTMLElement) => void }) {
  return (
    <h1 data-vesta="welcome-logo" data-layered={props.intro ? '' : undefined} ref={props.ref}>
      <img data-vesta="welcome-logo-image" src={LOGO_SRC} alt="Vesta" width="1200" height="269" draggable={false} />
      <Show when={props.intro}>
        <span data-vesta="welcome-logo-mark" aria-hidden="true">
          <img src={LOGO_SRC} alt="" width="1200" height="269" draggable={false} />
        </span>
        <span data-vesta="welcome-logo-ember" aria-hidden="true" />
      </Show>
    </h1>
  );
}
