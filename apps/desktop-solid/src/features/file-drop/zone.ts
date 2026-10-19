import { onSettled } from 'solid-js';
import { getDropController } from './native-bridge';
import { nativeInstances, reportInstanceError } from '../instances/native-service';
import type { DropAccept, DropZoneState } from './drop-controller';
import { t } from '../../localization';
import './drop.css';

let nextZone = 0;
/** Native events alone own filesystem drops; browser File objects never start imports. */
export function useNativeDropZone(options: {
  element: () => HTMLElement | undefined;
  accept?: DropAccept;
  extensions?: string[];
  disabled?: () => boolean;
  drop: (paths: string[]) => void;
  onStateChange?: (state: DropZoneState) => void;
}) {
  const id = `solid-drop-${++nextZone}`;
  onSettled(() => {
    if (!nativeInstances) return;
    const unregister = getDropController().register({
      id, getElement: options.element,
      getAccept: () => options.accept ?? 'all',
      getAllowedExtensions: () => options.extensions ?? [],
      isDisabled: () => options.disabled?.() ?? false,
      onFileDrop: options.drop,
      onRejected: () => reportInstanceError(t('drop.rejected')),
      onStateChange: (state) => { options.element()?.setAttribute('data-native-drop', state); options.onStateChange?.(state); },
    });
    return () => { unregister(); options.element()?.removeAttribute('data-native-drop'); };
  });
}
