import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import './icon-tile.css';

/** Shared settings marker. Keep existing public part hooks while sharing geometry and tone. */
export function IconTile(props: { hook?: string; class?: string; size?: number; tone?: 'neutral' | 'accent'; image?: string; children?: JSX.Element }) {
  return <span data-vesta={props.hook ?? 'icon-tile'} data-vesta-icon-tile="" data-tone={props.tone ?? 'neutral'}
    aria-hidden="true" class={props.class} style={props.size ? { '--icon-tile-size': `${props.size}px` } as JSX.CSSProperties : undefined}>
    <Show when={props.image} fallback={props.children}>{(src) => <img src={src()} alt="" draggable="false" />}</Show>
  </span>;
}
