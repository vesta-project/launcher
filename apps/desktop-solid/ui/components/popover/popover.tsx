import { Popover as KobaltePopover } from '@kobalte/core/popover';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import { useOverlayMount } from '../overlay/mount';
import type { Placement, TriggerRender } from '../overlay/types';
import '../overlay/overlay.css';
import './popover.css';

export interface PopoverProps {
  trigger: TriggerRender;
  title?: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  /** Trap focus and block outside interaction while open. */
  modal?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
}

export function Popover(props: PopoverProps) {
  const mount = useOverlayMount();
  const title = children(() => props.title);
  const description = children(() => props.description);

  return (
    <KobaltePopover
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={props.onOpenChange}
      placement={props.placement ?? 'bottom-start'}
      gutter={4}
      modal={props.modal}
    >
      <KobaltePopover.Trigger as={props.trigger} />
      <KobaltePopover.Portal mount={mount}>
        <KobaltePopover.Content data-vesta="popover" class={props.class} style={props.style}>
          <Show when={title()}>
            <KobaltePopover.Title data-vesta="popover-title">{title()}</KobaltePopover.Title>
          </Show>
          <Show when={description()}>
            <KobaltePopover.Description data-vesta="popover-description">{description()}</KobaltePopover.Description>
          </Show>
          {props.children}
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </KobaltePopover>
  );
}
