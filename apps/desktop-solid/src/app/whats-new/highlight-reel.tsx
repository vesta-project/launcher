import { Button } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { For, Show, createEffect, createSignal } from 'solid-js';
import type { FeatureRelease, Highlight } from '../../features/whats-new';
import { t } from '../../localization';
import { reducedMotion } from '../../pages/welcome/welcome-intro';
import { Scene } from './scenes';

/** How long each highlight stays up before the reel moves on by itself. */
const DWELL_MS = 8000;

function HighlightMedia(props: { highlight: Highlight; active: boolean; lap: number }) {
  let video: HTMLVideoElement | undefined;
  // Only the showing clip plays, from the start each time it comes round.
  createEffect(
    () => props.active,
    (active) => {
      if (!video) return;
      if (active && !reducedMotion()) {
        video.currentTime = 0;
        void video.play().catch(() => {});
      } else video.pause();
    },
  );
  return (
    <div data-vesta="reel-media" data-active={props.active ? '' : undefined}>
      {/* The scene is rebuilt each time its highlight comes round, so its story starts over. */}
      <Show when={props.highlight.clip} fallback={<Show when={props.active && props.lap + 1} keyed><Scene name={props.highlight.scene} /></Show>}>
        {(clip) => (
          <video
            data-vesta="reel-clip"
            src={clip().src}
            poster={clip().poster}
            muted
            loop
            playsinline
            preload="metadata"
            controls={reducedMotion()}
            aria-hidden="true"
            ref={(element: HTMLVideoElement) => (video = element)}
          />
        )}
      </Show>
    </div>
  );
}

/**
 * A release's highlights one at a time, like stories: the media stage on top with a progress
 * segment per highlight, the words underneath. It moves on by itself (held while the picture is
 * pointed at, never with reduced motion) and stops on the last one, where `finish` takes over.
 */
export function HighlightReel(props: {
  release: FeatureRelease;
  /** The buttons on the last highlight. */
  finish: JSX.Element;
}) {
  const [index, setIndex] = createSignal(0, { name: 'reelIndex' });
  const highlights = () => props.release.highlights;
  const current = () => highlights()[index()]!;
  const last = () => index() === highlights().length - 1;
  /** Bumped on every move, so picking a bar (even the current one) restarts its fill and scene. */
  const [lap, setLap] = createSignal(0, { name: 'reelLap' });
  const go = (next: number) => {
    setIndex(Math.min(Math.max(next, 0), highlights().length - 1));
    setLap((value) => value + 1);
  };
  let root: HTMLDivElement | undefined;
  // The button pressed may be gone on the next highlight (Next becomes the finish), so keep focus in the reel.
  createEffect(index, () => queueMicrotask(() => {
    if (root && !root.contains(document.activeElement)) root.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }));

  return (
    <div
      ref={(element: HTMLDivElement) => (root = element)}
      data-vesta="reel"
      data-auto={reducedMotion() ? undefined : ''}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); go(index() + 1); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); go(index() - 1); }
      }}
    >
      <div data-vesta="reel-stage">
        <For each={highlights()}>
          {(highlight, at) => <HighlightMedia highlight={highlight} active={at() === index()} lap={lap()} />}
        </For>
        <div data-vesta="reel-segments">
          <For each={highlights()}>
            {(highlight, at) => (
              <button
                type="button"
                data-vesta="reel-segment"
                data-state={at() < index() ? 'done' : at() === index() ? 'current' : 'ahead'}
                aria-label={t(highlight.title)}
                aria-current={at() === index() ? 'step' : undefined}
                tabindex={-1}
                onClick={() => go(at())}
              >
                {/* Remounted each time it becomes current, so the fill always starts from empty. */}
                <Show when={at() === index() && lap() + 1} keyed fallback={<i data-vesta="reel-segment-fill" />}>
                  <i
                    data-vesta="reel-segment-fill"
                    style={{ '--reel-dwell': `${DWELL_MS}ms` }}
                    onAnimationEnd={() => { if (!last()) go(index() + 1); }}
                  />
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={current()} keyed>
        {(highlight) => (
          <div data-vesta="reel-copy" aria-live="polite">
            <span data-vesta="reel-count">{t('whats-new.progress', { count: index() + 1, total: highlights().length })}</span>
            <h3 data-vesta="reel-title">{t(highlight.title)}</h3>
            <p data-vesta="reel-body">{t(highlight.body)}</p>
          </div>
        )}
      </Show>

      <footer data-vesta="reel-actions">
        <span data-vesta="reel-spacer" />
        <Show when={index() > 0}>
          <Button size="sm" variant="ghost" onClick={() => go(index() - 1)}>{t('whats-new.back')}</Button>
        </Show>
        <Show when={!last()} fallback={props.finish}>
          <Button size="sm" tone="accent" data-autofocus onClick={() => go(index() + 1)}>{t('whats-new.next')}</Button>
        </Show>
      </footer>
    </div>
  );
}
