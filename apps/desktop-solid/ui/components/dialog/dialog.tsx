import { Dialog as KobalteDialog } from '@kobalte/core/dialog';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import { CloseGlyph } from '../../internal/icons';
import { IconButton } from '../button/button';
import { useOverlayMount } from '../overlay/mount';
import type { TriggerRender } from '../overlay/types';
import '../overlay/overlay.css';
import './dialog.css';

export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps {
  /** Required: names the dialog for assistive technology. */
  title: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
  /** Actions, right-aligned. Put the primary action last. */
  footer?: JSX.Element;
  trigger?: TriggerRender;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Width step. Defaults to `md`. */
  size?: DialogSize;
  /** Show the header close button. Escape and the backdrop still close. Defaults to true. */
  closeButton?: boolean;
  /** Label for the close button. Defaults to "Close". */
  closeLabel?: string;
}

export function Dialog(props: DialogProps) {
  const mount = useOverlayMount();
  const description = children(() => props.description);
  const footer = children(() => props.footer);

  return (
    <KobalteDialog open={props.open} defaultOpen={props.defaultOpen} onOpenChange={props.onOpenChange}>
      <Show when={props.trigger}>{(trigger) => <KobalteDialog.Trigger as={trigger()} />}</Show>
      <KobalteDialog.Portal mount={mount}>
        <KobalteDialog.Overlay data-vesta="dialog-backdrop" />
        <div data-vesta="dialog-positioner">
          <KobalteDialog.Content data-vesta="dialog" data-size={props.size ?? 'md'}>
            <header data-vesta="dialog-header">
              <KobalteDialog.Title data-vesta="dialog-title">{props.title}</KobalteDialog.Title>
              <Show when={props.closeButton !== false}>
                <KobalteDialog.CloseButton
                  as={(closeProps: Record<string, unknown>) => (
                    <IconButton
                      {...closeProps}
                      icon={<CloseGlyph />}
                      label={props.closeLabel ?? 'Close'}
                      variant="ghost"
                      size="sm"
                      tooltip={false}
                    />
                  )}
                />
              </Show>
            </header>
            <Show when={description()}>
              <KobalteDialog.Description data-vesta="dialog-description">{description()}</KobalteDialog.Description>
            </Show>
            <Show when={props.children}>
              <div data-vesta="dialog-body">{props.children}</div>
            </Show>
            <Show when={footer()}>
              <footer data-vesta="dialog-footer">{footer()}</footer>
            </Show>
          </KobalteDialog.Content>
        </div>
      </KobalteDialog.Portal>
    </KobalteDialog>
  );
}
