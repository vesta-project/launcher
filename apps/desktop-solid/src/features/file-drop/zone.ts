import { createSignal, onSettled } from 'solid-js';
import { getDropController } from './native-bridge';
import { nativeInstances, reportInstanceError } from '../instances/native-service';
import type { DropAccept, DropZoneState } from './drop-controller';
import { t } from '../../localization';
import './drop.css';

let nextZone = 0;

/**
 * Native events alone own filesystem drops; browser File objects never start imports.
 *
 * Every zone shares one look (drop.css): `data-drop-target` carries the state and
 * `data-drop-hint` the words in the pill. A `quiet` zone still receives drops but draws
 * nothing, for catch-all fallbacks that should not light up the whole window.
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
  onSettled(() => {
    if (!nativeInstances) return;
    const element = () => options.element();
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
        const target = element();
        if (target && !options.quiet) {
          if (state === 'idle') {
            target.removeAttribute('data-drop-target');
            target.removeAttribute('data-drop-hint');
          } else {
            target.setAttribute('data-drop-target', state);
            target.setAttribute('data-drop-hint', state === 'rejected' ? t('drop.cannot-add') : (options.hint?.() ?? t('drop.release')));
          }
        }
        options.onStateChange?.(state);
      },
    });
    return () => {
      unregister();
      const target = element();
      target?.removeAttribute('data-drop-target');
      target?.removeAttribute('data-drop-hint');
      target?.removeAttribute('data-drop-zone');
    };
  });
}

/** A short "caught it" pulse on the element that received the files. */
function landed(element: HTMLElement | undefined) {
  if (!element) return;
  element.removeAttribute('data-drop-landed');
  void element.offsetWidth;
  element.setAttribute('data-drop-landed', '');
  setTimeout(() => element.removeAttribute('data-drop-landed'), 700);
}

const [dragging, setDragging] = createSignal(false, { name: 'fileDragInWindow' });
const [overZone, setOverZone] = createSignal(false, { name: 'fileDragOverZone' });
/** True while files from the OS are being dragged over the window. */
export { dragging as fileDragActive, overZone as fileDragOverZone };

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
