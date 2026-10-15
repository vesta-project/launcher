import './icon.css';
import type { JSX } from '@solidjs/web';

// Launcher icons come from the old implementation's asset set (copied under src/assets).
// They are plain outlines/fills without a colour of their own, so they inherit
// `currentColor`. Swap the set in one place when the SVG pass lands.
const icons = import.meta.glob<string>(['../assets/icons/**/*.svg', '../assets/branding/**/*.svg'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const byName = new Map(
  Object.entries(icons).map(([path, svg]) => [path.replace(/^.*\/assets\//, '').replace(/\.svg$/, ''), svg]),
);

export type IconName = string;

/** Renders a bundled icon by its path under assets, e.g. `icons/actions/play`. */
export function Icon(props: { name: IconName; size?: number; class?: string; label?: string }) {
  const svg = () => byName.get(props.name) ?? '';
  return (
    <span
      data-vesta="icon"
      class={props.class}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
      style={{ '--icon-size': `${props.size ?? 16}px` } as JSX.CSSProperties}
      // Bundled, in-repo SVG only; never user-supplied markup.
      // oxlint-disable-next-line solid/no-innerhtml
      innerHTML={svg()}
    />
  );
}
