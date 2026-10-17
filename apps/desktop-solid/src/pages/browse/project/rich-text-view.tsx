import { createEffect } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { parseProjectUrl, projectPath } from '../../../features/browse/browse-model';
import { renderRichText } from '../../../features/browse/rich-text';
import { t } from '../../../localization';
import { openExternal } from '../install-actions';
import './rich-text.css';

/**
 * Sanitised provider markup (see rich-text.ts), mounted as a DOM fragment. Links to other
 * projects on a supported source open their page here; every other link opens in the system
 * browser. Clicking an image that is not a link hands it to `onImage` (the gallery viewer).
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
      // Middle-click would otherwise ask the webview to open a window of its own.
      onAuxClick={follow}
    />
  );
}
