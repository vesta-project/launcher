import type { JSX } from '@solidjs/web';
import { For, Show } from 'solid-js';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, Dialog, mergeElementProps } from '@vesta/ui';
import type { InstanceArrangeActions } from './action-menu';
import { t } from '../../localization';
import { GROUP_NAME_MAX, groupColors, type LibraryGroup } from './library-layout';
import type { InstanceCardData } from './instance-card';

const colorNames = {
  205: 'library.color-blue',
  265: 'library.color-purple',
  150: 'library.color-green',
  35: 'library.color-amber',
  330: 'library.color-pink',
} as const;

/**
 * A library group as a tile: up to four member previews and the group's name. Opening it
 * shows the members in a popup. `data-folder-tile` lets a file held over it open the group.
 */
export function LibraryFolderTile(props: {
  group: LibraryGroup;
  members: InstanceCardData[];
  open: boolean;
  arranging: boolean;
  /** A file or card is over the tile: pending while dwelling, ready when a drop goes in. */
  dropState?: 'pending' | 'ready';
  onOpen: () => void;
  onKeyDown?: JSX.EventHandler<HTMLButtonElement, KeyboardEvent>;
  actions: Pick<InstanceArrangeActions, 'canMoveEarlier' | 'canMoveLater' | 'moveEarlier' | 'moveLater' | 'moveWithKeyboard' | 'arrangeLibrary'>;
  onEdit: () => void;
  onUngroup: () => void;
}) {
  return (
    <ContextMenu trigger={(triggerProps) => (
      <button
        {...mergeElementProps<Record<string, unknown>>(triggerProps, {
          onKeyDown: (event: KeyboardEvent & { currentTarget: HTMLButtonElement; target: Element }) => props.onKeyDown?.(event),
        })}
        type="button"
        data-vesta="library-folder"
        data-folder-tile={props.group.id}
        data-arranging={props.arranging ? '' : undefined}
        data-drop-state={props.dropState}
        aria-label={t('library.group-open', { name: props.group.name, count: props.members.length })}
        aria-haspopup="dialog"
        aria-expanded={props.open ? 'true' : 'false'}
        style={{ '--library-folder-hue': String(props.group.color) } as JSX.CSSProperties}
        onClick={() => props.onOpen()}
      >
        <span data-vesta="library-folder-preview" aria-hidden="true">
          <For each={props.members.slice(0, 4)}>
            {(member) => (
              <span
                data-vesta="library-folder-mini"
                style={{ '--library-folder-mini-image': `url('${member.image}')` } as JSX.CSSProperties}
              />
            )}
          </For>
        </span>
        <span data-vesta="library-folder-caption">{props.group.name}</span>
      </button>
    )}>
      <ContextMenuItem onSelect={props.onOpen}>{t('library.open-group')}</ContextMenuItem>
      <ContextMenuItem onSelect={props.onEdit}>{t('library.edit-group')}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!props.actions.canMoveEarlier()} onSelect={props.actions.moveEarlier}>{t('library.move-earlier')}</ContextMenuItem>
      <ContextMenuItem disabled={!props.actions.canMoveLater()} onSelect={props.actions.moveLater}>{t('library.move-later')}</ContextMenuItem>
      <ContextMenuItem onSelect={props.actions.moveWithKeyboard}>{t('library.move-keyboard')}</ContextMenuItem>
      <ContextMenuItem onSelect={props.actions.arrangeLibrary}>{t('library.arrange')}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={props.onUngroup}>{t('library.ungroup')}</ContextMenuItem>
    </ContextMenu>
  );
}

/**
 * The open group. While arranging, its name and colour can change and its members can be
 * dragged within it or out of it; `data-library-surface` marks its grid for the drag code.
 * Focus returns to the group's tile when it closes.
 */
export function LibraryFolderPopup(props: {
  group: LibraryGroup;
  count: number;
  arranging: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
  onRecolor: (hue: number) => void;
  children: JSX.Element;
}) {
  return (
    <Dialog
      open
      size="lg"
      title={props.group.name}
      description={t('library.group-count', { count: props.count })}
      closeLabel={t('nav.close')}
      class="library-folder-popup"
      style={{ '--library-folder-hue': String(props.group.color) } as JSX.CSSProperties}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        document.querySelector<HTMLElement>(`[data-folder-tile="${CSS.escape(props.group.id)}"]`)?.focus();
      }}
    >
      <div
        data-vesta="library-folder-popup"
        data-folder-popup={props.group.id}
      >
        <Show when={props.arranging}>
          <div data-vesta="library-folder-settings">
            <input
              data-vesta="library-folder-name"
              aria-label={t('library.group-name')}
              maxlength={GROUP_NAME_MAX}
              value={props.group.name}
              onChange={(event) => {
                props.onRename(event.currentTarget.value);
                event.currentTarget.value = props.group.name;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <div data-vesta="library-folder-colors" role="group" aria-label={t('library.group-color')}>
              <For each={groupColors}>
                {(hue) => (
                  <button
                    type="button"
                    data-vesta="library-folder-color"
                    style={{ '--library-folder-swatch': String(hue) } as JSX.CSSProperties}
                    aria-label={t(colorNames[hue])}
                    data-tip={t(colorNames[hue])}
                    aria-pressed={props.group.color === hue ? 'true' : 'false'}
                    onClick={() => props.onRecolor(hue)}
                  />
                )}
              </For>
            </div>
          </div>
        </Show>
        <div data-vesta="library-folder-scroll">{props.children}</div>
      </div>
    </Dialog>
  );
}
