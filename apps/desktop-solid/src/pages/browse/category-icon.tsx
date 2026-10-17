import { Show } from 'solid-js';

// Category icons arrive as inline SVG markup (Modrinth) or image URLs (CurseForge). Markup is
// never injected into the page: it becomes a CSS mask, where scripts cannot run and the
// glyph takes the surrounding text colour.
const masks = new Map<string, string>();
function maskUrl(svg: string): string {
  let url = masks.get(svg);
  if (!url) {
    // Modrinth's markup omits the namespace, without which an SVG image renders nothing.
    const markup = /<svg[^>]*\sxmlns=/.test(svg) ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    url = `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
    masks.set(svg, url);
    if (masks.size > 400) masks.delete(masks.keys().next().value as string);
  }
  return url;
}

export function CategoryIcon(props: { icon: string | null | undefined }) {
  return (
    <Show when={props.icon}>
      {(icon) => (
        <Show
          when={/^https?:\/\//.test(icon())}
          fallback={
            <Show when={icon().trimStart().startsWith('<svg')}>
              <span
                data-vesta="browse-category-icon"
                data-kind="mask"
                aria-hidden="true"
                style={{ '--browse-icon': maskUrl(icon()) }}
              />
            </Show>
          }
        >
          <img
            data-vesta="browse-category-icon"
            data-kind="image"
            src={icon()}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </Show>
      )}
    </Show>
  );
}
