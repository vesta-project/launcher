import { createEffect, onCleanup } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { parseProjectUrl, projectPath } from '../../../features/browse/browse-model';
import { prefetchProject } from '../../../features/browse/browse-projects';
import { renderRichText } from '../../../features/browse/rich-text';
import { t } from '../../../localization';
import { openExternal } from '../install-actions';
import './rich-text.css';

/**
 * Sanitised provider markup (see rich-text.ts), mounted as a DOM fragment. Links to other
 * projects on a supported source open their page here; every other link opens in the system
 * browser (after the shared confirmation). Resting on a project link loads that project in the
 * background (the bounded hover queue), so following it, or the link preview, has its name ready.
 * Clicking an image that is not a link hands it to `onImage` (the gallery viewer).
 */
export function RichTextView(props: {
  source: string;
  format: 'markdown' | 'html';
  onImage?: (src: string) => void;
  'aria-label'?: string;
}) {
  let host!: HTMLDivElement;

  createEffect(
    () => ({ source: props.source, format: props.format, spoiler: t('browse.spoiler') }),
    ({ source, format, spoiler }) => {
      try {
        host.replaceChildren(renderRichText(source, format, { spoiler }));
      } catch {
        host.textContent = source;
      }
    },
  );

  // A short rest before prefetching, so sweeping across a page of links loads nothing.
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hovered: Element | undefined;
  const linkAt = (target: EventTarget | null) => {
    const link = target instanceof Element ? target.closest('a[href]') : null;
    return link && host.contains(link) ? link : undefined;
  };
  const rest = (event: PointerEvent) => {
    const link = linkAt(event.target);
    if (link === hovered) return;
    hovered = link;
    clearTimeout(hoverTimer);
    const project = link ? parseProjectUrl(link.getAttribute('href') ?? '') : undefined;
    if (project) hoverTimer = setTimeout(() => prefetchProject(project.platform, project.id), 150);
  };
  onCleanup(() => clearTimeout(hoverTimer));

  const follow = (event: MouseEvent) => {
    const element = event.target instanceof Element ? event.target : null;
    const link = element?.closest('a');
    if (link && host.contains(link)) {
      event.preventDefault();
      const href = link.getAttribute('href');
      if (!href || event.button > 1) return;
      const project = parseProjectUrl(href);
      if (project) transitionTo(projectPath(project.platform, project.id));
      else void openExternal(href);
      return;
    }
    const image = element?.closest('img');
    if (image && event.button === 0 && props.onImage) props.onImage(image.currentSrc || image.src);
  };

  return (
    <div
      data-vesta="rich-text"
      aria-label={props['aria-label']}
      ref={(element: HTMLDivElement) => (host = element)}
      onClick={follow}
      onPointerOver={rest}
      onPointerLeave={() => {
        hovered = undefined;
        clearTimeout(hoverTimer);
      }}
      // Middle-click would otherwise ask the webview to open a window of its own.
      onAuxClick={follow}
    />
  );
}
