import { createEffect, createSignal, onSettled } from 'solid-js';
import { getDropController } from './native-bridge';
import { nativeInstances, reportInstanceError } from '../instances/native-service';
import type { DropAccept, DropZoneState } from './drop-controller';
import { t } from '../../localization';
import './drop.css';

let nextZone = 0;

const [dragging, setDragging] = createSignal(false, { name: 'fileDragInWindow' });
const [overZone, setOverZone] = createSignal(false, { name: 'fileDragOverZone' });
/** True while files from the OS are being dragged over the window. */
export { dragging as fileDragActive, overZone as fileDragOverZone };

/**
 * Native events alone own filesystem drops; browser File objects never start imports.
 *
 * Every zone shares one look (drop.css): `data-drop-target` carries the state and
 * `data-drop-hint` the words in the pill. A `quiet` zone still receives drops but draws
 * nothing, for catch-all fallbacks that should not light up the whole window.
 *
 * While files are dragged anywhere over the window, enabled zones carry `data-drop-invite`.
 * An element that already uses its own ::before/::after sets `data-drop-decor` and renders
 * a `[data-vesta=drop-decor]` child; the drawing attributes are mirrored onto that child.
 */
export function useNativeDropZone(options: {
  element: () => HTMLElement | undefined;
  accept?: DropAccept;
  extensions?: string[];
  disabled?: () => boolean;
  drop: (paths: string[]) => void;
  onStateChange?: (state: DropZoneState) => void;
  /** Short words for the pill while a drop here would work, e.g. "Add to Fabulously Optimized". */
  hint?: () => string;
  quiet?: boolean;
}) {
  const id = `solid-drop-${++nextZone}`;
  const element = () => options.element();
  if (nativeInstances && !options.quiet) {
    createEffect(() => dragging() && !(options.disabled?.() ?? false), (invite) => {
      paint(element(), (target) => target.toggleAttribute('data-drop-invite', invite));
    }, { name: 'dropZoneInvite' });
  }
  onSettled(() => {
    if (!nativeInstances) return;
    if (!options.quiet) element()?.setAttribute('data-drop-zone', '');
    const unregister = getDropController().register({
      id, getElement: options.element,
      getAccept: () => options.accept ?? 'all',
      getAllowedExtensions: () => options.extensions ?? [],
      isDisabled: () => options.disabled?.() ?? false,
      onFileDrop: (paths) => {
        if (!options.quiet) landed(element());
        options.drop(paths);
      },
      onRejected: () => reportInstanceError(t('drop.rejected')),
      onStateChange: (state) => {
        if (!options.quiet) {
          const hint = state === 'rejected' ? t('drop.cannot-add') : (options.hint?.() ?? t('drop.release'));
          paint(element(), (target) => {
            if (state === 'idle') {
              target.removeAttribute('data-drop-target');
              target.removeAttribute('data-drop-hint');
            } else {
              target.setAttribute('data-drop-target', state);
              target.setAttribute('data-drop-hint', hint);
            }
          });
        }
        options.onStateChange?.(state);
      },
    });
    return () => {
      unregister();
      element()?.removeAttribute('data-drop-zone');
      paint(element(), (target) => {
        for (const name of ['data-drop-target', 'data-drop-hint', 'data-drop-invite', 'data-drop-landed']) target.removeAttribute(name);
      });
    };
  });
}

/** Applies a drawing attribute change to the zone and, when it has one, its decor child. */
function paint(element: HTMLElement | undefined, change: (target: HTMLElement) => void) {
  if (!element) return;
  change(element);
  if (!element.hasAttribute('data-drop-decor')) return;
  const decor = element.querySelector<HTMLElement>(':scope > [data-vesta="drop-decor"]');
  if (decor) change(decor);
}

/** A short "caught it" pulse on the element that received the files. */
function landed(element: HTMLElement | undefined) {
  paint(element, (target) => {
    target.removeAttribute('data-drop-landed');
    void target.offsetWidth;
    target.setAttribute('data-drop-landed', '');
  });
  setTimeout(() => paint(element, (target) => target.removeAttribute('data-drop-landed')), 700);
}

let watching = false;
/**
 * Tracks whether files are being dragged over the window, and whether the pointer is over a
 * drop target, so targets can invite the drop and a hint can say where to let go. Also
 * mirrors it on <html data-file-drag> for CSS.
 */
export function watchFileDrag() {
  if (watching || !nativeInstances) return () => {};
  watching = true;
  const stop = getDropController().observe((observation) => {
    const active = observation.type === 'move' && observation.point !== null;
    setDragging(active);
    setOverZone(active && observation.hits.some((hit) => hit.closest('[data-drop-zone]')));
    document.documentElement.toggleAttribute('data-file-drag', active);
  });
  return () => {
    watching = false;
    stop();
    document.documentElement.removeAttribute('data-file-drag');
  };
}
