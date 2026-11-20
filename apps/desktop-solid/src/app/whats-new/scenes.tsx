import { For } from 'solid-js';
import type { SceneName } from '../../features/whats-new';
import { t } from '../../localization';
import './scenes.css';

/**
 * The little animated pictures behind each highlight, built from the theme so they always match
 * the launcher. Each one tells its own story and plays from the start whenever its highlight comes
 * round (the reel remounts it). With reduced motion every scene rests on its finished frame.
 */
export function Scene(props: { name: SceneName }) {
  return (
    <div data-vesta="scene" data-scene={props.name} aria-hidden="true">
      {props.name === 'paint' ? <PaintScene /> : props.name === 'server' ? <ServerScene /> : <SpeedScene />}
    </div>
  );
}

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

/** A small launcher window repainting itself through a few accents, with the swatches below. */
function PaintScene() {
  return (
    <>
      <div data-vesta="scene-paint-window">
        <span data-vesta="scene-paint-rail">
          <For each={range(4)}>{(index) => <i style={{ '--i': index }} />}</For>
        </span>
        <span data-vesta="scene-paint-grid">
          <For each={range(6)}>{(index) => <i style={{ '--i': index }} />}</For>
        </span>
      </div>
      <div data-vesta="scene-paint-swatches">
        <For each={range(5)}>{(index) => <i style={{ '--i': index }} />}</For>
      </div>
    </>
  );
}

/** A server card coming online: the status turns, friends join and the console scrolls. */
function ServerScene() {
  return (
    <div data-vesta="scene-server-card">
      <header data-vesta="scene-server-head">
        <span data-vesta="scene-server-icon" />
        <b>{t('whats-new.scene-server-name')}</b>
        <span data-vesta="scene-server-status">
          <i />
          <span data-vesta="scene-server-starting">{t('whats-new.scene-server-starting')}</span>
          <span data-vesta="scene-server-online">{t('whats-new.scene-server-online')}</span>
        </span>
      </header>
      <ul data-vesta="scene-server-players">
        <For each={range(4)}>{(index) => <li style={{ '--i': index }} />}</For>
      </ul>
      <div data-vesta="scene-server-console">
        <For each={range(4)}>{(index) => <i style={{ '--i': index }} />}</For>
      </div>
    </div>
  );
}

/** Browse answering at once: the search settles and every result is already there. */
function SpeedScene() {
  return (
    <div data-vesta="scene-speed-page">
      <span data-vesta="scene-speed-search">
        <i />
      </span>
      <div data-vesta="scene-speed-grid">
        <For each={range(6)}>
          {(index) => (
            <span data-vesta="scene-speed-card" style={{ '--i': index }}>
              <i />
              <b />
              <b />
            </span>
          )}
        </For>
      </div>
    </div>
  );
}
