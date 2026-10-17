import { onSettled } from 'solid-js';
import { useOverlayMount } from '../overlay/mount';
import './tooltip.css';

export interface TooltipHintsProps {
  /** Milliseconds before the first hint shows. Defaults to 500, like Tooltip. */
  openDelay?: number;
}

/**
 * One shared tooltip for every element carrying `data-tip="…"` — the light alternative to
 * wrapping each tag and stat in a Tooltip. Mount it once near the root. It follows pointer
 * hover and keyboard focus, sits above the element (below when there is no room), and once
 * one hint has shown, moving to the next shows it straight away. Like Tooltip, the text is
 * supplementary: the element still needs its own accessible name.
 */
export function TooltipHints(props: TooltipHintsProps) {
  const mount = useOverlayMount();

  onSettled(() => {
    const tip = document.createElement('div');
    tip.dataset.vesta = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.style.cssText = 'position:fixed;inset:0 auto auto 0;display:none';
    (mount ?? document.body).append(tip);

    let current: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cool: ReturnType<typeof setTimeout> | undefined;
    let warm = false;

    const place = (element: HTMLElement) => {
      const gap = 6;
      const edge = 4;
      const anchor = element.getBoundingClientRect();
      const box = tip.getBoundingClientRect();
      let top = anchor.top - box.height - gap;
      if (top < edge) top = anchor.bottom + gap;
      const left = Math.min(
        Math.max(anchor.left + anchor.width / 2 - box.width / 2, edge),
        window.innerWidth - box.width - edge,
      );
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    };

    const show = (element: HTMLElement) => {
      const text = element.dataset.tip;
      if (!text || !element.isConnected) return;
      tip.textContent = text;
      tip.style.display = 'block';
      tip.toggleAttribute('data-expanded', !warm);
      place(element);
      warm = true;
      clearTimeout(cool);
    };

    const hide = () => {
      clearTimeout(timer);
      current = null;
      if (tip.style.display === 'none') return;
      tip.style.display = 'none';
      tip.removeAttribute('data-expanded');
      clearTimeout(cool);
      cool = setTimeout(() => (warm = false), 300);
    };

    const target = (node: EventTarget | null) =>
      node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null;

    const arm = (element: HTMLElement | null) => {
      if (element === current) return;
      hide();
      if (!element) return;
      current = element;
      timer = setTimeout(() => show(element), warm ? 0 : (props.openDelay ?? 500));
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      arm(target(event.target));
    };
    const onFocus = (event: FocusEvent) => {
      const element = target(event.target);
      if (element?.matches(':focus-visible')) arm(element);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && hide();

    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', onKey);
    document.documentElement.addEventListener('pointerleave', hide);
    window.addEventListener('blur', hide);

    return () => {
      clearTimeout(timer);
      clearTimeout(cool);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', onKey);
      document.documentElement.removeEventListener('pointerleave', hide);
      window.removeEventListener('blur', hide);
      tip.remove();
    };
  });

  return null;
}
