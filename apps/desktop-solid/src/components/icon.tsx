import './icon.css';
import type { JSX } from '@solidjs/web';

// Bundled Lucide outlines and launcher glyphs inherit currentColor.
// Keep their attribution alongside the plain SVG assets.
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
      data-brand={props.name === "branding/sources/modrinth" ? "modrinth" : props.name === "branding/sources/curseforge" ? "curseforge" : undefined}
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
