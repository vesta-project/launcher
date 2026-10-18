import { Portal } from '@solidjs/web';
import { useOverlayMount } from '@vesta/ui';
import { createMemo, createSignal, onSettled, Show } from 'solid-js';
import { t } from '../../localization';
import { parseProjectUrl, sourceById } from '../browse/browse-model';
import { peekProject } from '../browse/browse-projects';
import './links.css';

/** Elements whose address is worth previewing: real links, and buttons that open one (`data-href`). */
const selector = 'a[href], [data-href]';
const previewable = /^(https?:|mailto:)/i;

function addressOf(element: Element | null): { element: HTMLElement; href: string } | undefined {
  const link = element?.closest<HTMLElement>(selector);
  if (!link) return undefined;
  const href = (link.dataset.href ?? link.getAttribute('href') ?? '').trim();
  // In-app routes (`#/…`) and empty hrefs are navigation, not addresses.
  return previewable.test(href) ? { element: link, href } : undefined;
}

/** A readable address: no scheme for the web, decoded where that is safe. */
function readable(href: string) {
  let text = href.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  try {
    text = decodeURI(text);
  } catch {
    /* Keep the raw text when it is not valid percent-encoding. */
  }
  return text;
}

/**
 * The browser-style status pill: while a link is hovered or focused, its address shows in the
 * bottom-left corner of the window (bottom-right when the link itself sits there). A link to a
 * project the launcher can open names that project instead, once it is known. Mount once, in
 * the shell; it listens on the document, so any `a[href]` or `[data-href]` takes part.
 */
export function LinkPreview() {
  const mount = useOverlayMount();
  const [href, setHref] = createSignal<string | undefined>(undefined, { name: 'linkPreviewHref' });
  const [side, setSide] = createSignal<'start' | 'end'>('start', { name: 'linkPreviewSide' });

  const label = createMemo(
    () => {
      const value = href();
      if (!value) return undefined;
      const project = parseProjectUrl(value);
      const known = project && peekProject(project.platform, project.id);
      if (project && known) return t('links.preview-project', { name: known.name, source: sourceById(project.platform).label });
      return readable(value);
    },
    { name: 'linkPreviewLabel' },
  );

  onSettled(() => {
    let current: HTMLElement | undefined;
    const show = (found: ReturnType<typeof addressOf>) => {
      if (!found) {
        current = undefined;
        setHref(undefined);
        return;
      }
      if (found.element === current && found.href === href()) return;
      current = found.element;
      // Like a browser, step aside when the link itself sits in the corner.
      const box = found.element.getBoundingClientRect();
      setSide(box.bottom > window.innerHeight - 40 && box.left < window.innerWidth / 2 ? 'end' : 'start');
      setHref(found.href);
    };
    const hide = () => show(undefined);
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') show(addressOf(event.target as Element | null));
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches(':focus-visible')) show(addressOf(target));
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    // A click usually navigates or opens a dialog; the hovered link may be gone.
    document.addEventListener('click', hide, true);
    document.documentElement.addEventListener('pointerleave', hide);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('click', hide, true);
      document.documentElement.removeEventListener('pointerleave', hide);
      window.removeEventListener('blur', hide);
    };
  });

  return (
    <Portal mount={mount}>
      <Show when={label()}>
        {(text) => (
          <div data-vesta="link-preview" data-side={side()} aria-hidden="true">
            {text()}
          </div>
        )}
      </Show>
    </Portal>
  );
}
