import type { JSX } from '@solidjs/web';
import { Popover } from '@vesta/ui';
import { createEffect, createSignal, For, onSettled, Show } from 'solid-js';
import './overflow-row.css';

/*
 * One line of pills that never runs past its edge: whatever does not fit folds into a "+N"
 * button that opens the rest in a popover. Widths come from measurement, not a fixed count:
 * - each pill is measured once (cached per element) and again only after web fonts load;
 * - the "+N" width is read from a hidden probe holding the widest label it can show;
 * - one shared ResizeObserver reports the row's width, and its callback runs after layout
 *   but before paint, so the first frame already shows the folded row (no flicker);
 * - every pass reads everything first, then writes attributes, so there is no layout thrash.
 */

const [fontEpoch, setFontEpoch] = createSignal(0, { name: 'overflowRowFonts' });
if (typeof document !== 'undefined' && document.fonts)
  document.fonts.addEventListener('loadingdone', () => setFontEpoch((count) => count + 1));

type Listener = (width: number) => void;
const listeners = new WeakMap<Element, Listener>();
let observer: ResizeObserver | undefined;
function observe(element: Element, listener: Listener) {
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) listeners.get(entry.target)?.(entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
  });
  listeners.set(element, listener);
  observer.observe(element);
  return () => {
    listeners.delete(element);
    observer?.unobserve(element);
  };
}

/** How many leading items fit in `available` px, and whether the first must shrink to fit. */
export function fitCount(widths: readonly number[], gap: number, more: number, available: number) {
  const slack = 0.5;
  const all = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(widths.length - 1, 0);
  if (all <= available + slack) return { count: widths.length, squeeze: false };
  let used = more;
  let count = 0;
  while (count < widths.length - 1 && used + widths[count] + gap <= available + slack) {
    used += widths[count] + gap;
    count++;
  }
  // Nothing fits beside "+N": show the first item anyway, shrunk (it ellipsises), never none.
  return count === 0 ? { count: widths.length ? 1 : 0, squeeze: true } : { count, squeeze: false };
}

export interface OverflowRowProps<T> {
  items: readonly T[];
  key: (item: T) => string;
  /** Renders one pill. It must render exactly one element (it is measured and hidden as one). */
  children: (item: () => T) => JSX.Element;
  /** The "+N" text, e.g. `+3`. */
  moreLabel: (count: number) => string;
  /** Accessible name of the "+N" button, e.g. "3 more categories". */
  moreAriaLabel?: (count: number) => string;
  /** `data-vesta` hook of the row (layout and gap come from it). */
  hook: string;
  /** `data-vesta` hook given to the "+N" button and its probe; defaults to `overflow-more`. */
  moreHook?: string;
  /** Class of the popover panel, and the hook of the list inside it. */
  popoverClass?: string;
  popoverHook?: string;
}

/**
 * A single-line pill row that folds overflow into "+N" (see the notes above). The row's own
 * hook sets its gap and grid placement; this component only adds `data-overflow-row`.
 */
export function OverflowRow<T>(props: OverflowRowProps<T>) {
  let row!: HTMLDivElement;
  let probe!: HTMLSpanElement;
  const [shown, setShown] = createSignal(Number.POSITIVE_INFINITY, { name: 'overflowRowShown' });
  let widths = new WeakMap<Element, number>();
  let known = 0;

  const pills = () =>
    Array.from(row.children).filter((child) => !child.hasAttribute('data-overflow-control')) as HTMLElement[];

  const layout = (available = known) => {
    if (!row || available <= 0) return;
    const elements = pills();
    // Reads (revealing unmeasured pills first is the only write before them).
    const unknown = elements.filter((element) => !widths.has(element));
    for (const element of unknown) element.removeAttribute('data-overflow-hidden');
    for (const element of unknown) {
      const width = element.getBoundingClientRect().width;
      if (width > 0) widths.set(element, width);
    }
    const more = probe.getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    const fit = fitCount(
      elements.map((element) => widths.get(element) ?? 0),
      gap,
      more,
      available,
    );
    // Writes.
    elements.forEach((element, index) => element.toggleAttribute('data-overflow-hidden', index >= fit.count));
    row.toggleAttribute('data-overflow-squeeze', fit.squeeze);
    setShown(fit.count);
  };

  onSettled(() =>
    observe(row, (width) => {
      known = width;
      layout(width);
    }),
  );

  // New items (or freshly loaded fonts): measure what is new and fold again.
  createEffect(
    () => [props.items.length, props.items.map(props.key).join('\n'), fontEpoch()] as const,
    ([, , fonts], previous) => {
      if (previous && previous[2] !== fonts) widths = new WeakMap();
      layout();
    },
  );

  const hidden = () => props.items.slice(Math.min(shown(), props.items.length));

  return (
    <div data-vesta={props.hook} data-overflow-row="" ref={(element: HTMLDivElement) => (row = element)}>
      <For each={props.items} keyed={props.key}>
        {props.children}
      </For>
      <span
        data-vesta={props.moreHook ?? 'overflow-more'}
        data-kind="more"
        data-overflow-control=""
        data-overflow-probe=""
        aria-hidden="true"
        ref={(element: HTMLSpanElement) => (probe = element)}
      >
        {props.moreLabel(props.items.length)}
      </span>
      <Show when={hidden().length}>
        <Popover
          placement="bottom-start"
          class={props.popoverClass}
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              type="button"
              data-vesta={props.moreHook ?? 'overflow-more'}
              data-kind="more"
              data-overflow-control=""
              aria-label={props.moreAriaLabel?.(hidden().length)}
            >
              {props.moreLabel(hidden().length)}
            </button>
          )}
        >
          <div data-vesta={props.popoverHook}>
            <For each={hidden()} keyed={props.key}>
              {props.children}
            </For>
          </div>
        </Popover>
      </Show>
    </div>
  );
}
