import { onSettled } from 'solid-js';
import { isSourceId } from '../features/browse/browse-model';
import { prefetchBrowse } from '../features/browse/browse-store';
import { prefetchProject } from '../features/browse/browse-projects';

/** Small intent-driven warmups share the normal caches; they never navigate or publish a query. */
export function useNavigationPreloading() {
  onSettled(() => {
    if (typeof document === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovered: Element | null = null;
    const target = (node: EventTarget | null) => node instanceof Element
      ? node.closest('a[href^="#/browse"], [data-preload-browse]') : null;
    const warm = (element: Element | null) => {
      if (!element) return;
      if (element.hasAttribute('data-preload-browse')) {
        prefetchBrowse(element.getAttribute('data-preload-browse') || undefined);
        return;
      }
      const parts = element.getAttribute('href')?.slice(1).split('/').filter(Boolean) ?? [];
      if (parts[1] !== 'project') prefetchBrowse(parts[1] === 'for' ? parts[2] : undefined);
      else {
        try {
          const source = decodeURIComponent(parts[2] ?? '');
          const id = decodeURIComponent(parts[3] ?? '');
          if (isSourceId(source) && id) prefetchProject(source, id);
        } catch { /* Invalid link; normal navigation owns the error. */ }
      }
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const next = target(event.target);
      if (next === hovered) return;
      clearTimeout(timer);
      hovered = next;
      if (next) timer = setTimeout(() => warm(next), 120);
    };
    const out = (event: PointerEvent) => {
      if (hovered && !(event.relatedTarget instanceof Node && hovered.contains(event.relatedTarget))) {
        clearTimeout(timer); hovered = null;
      }
    };
    const focus = (event: FocusEvent) => warm(target(event.target));
    const down = (event: PointerEvent) => warm(target(event.target));
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('pointerdown', down);
    const idleHandle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(() => prefetchBrowse(), { timeout: 2500 }) : undefined;
    const idleTimer = idleHandle === undefined ? setTimeout(() => prefetchBrowse(), 700) : undefined;
    return () => {
      clearTimeout(timer); clearTimeout(idleTimer);
      if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('pointerdown', down);
    };
  });
}
