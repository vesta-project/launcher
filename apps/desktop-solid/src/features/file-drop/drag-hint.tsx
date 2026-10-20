import { Show } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import { fileDragActive, fileDragOverZone } from './zone';

/**
 * A small pill near the bottom of the window while files are held over nothing that takes
 * them. `onLibrary` picks the words: the grid's cards are the targets, anywhere else a drop
 * opens the "which instance?" dialog.
 */
export function FileDragHint(props: { enabled: boolean; onLibrary: boolean }) {
  return (
    <Show when={props.enabled && fileDragActive() && !fileDragOverZone()}>
      <div data-vesta="drop-float" role="status" aria-live="polite">
        <Icon name="icons/actions/add" size={14} />
        <span>{t(props.onLibrary ? 'drop.float-library' : 'drop.float-anywhere')}</span>
      </div>
    </Show>
  );
}
