import { Popover as KobaltePopover } from '@kobalte/core/popover';
import type { JSX } from '@solidjs/web';
import { children, createUniqueId, Show, useContext } from 'solid-js';
import { useOverlayMount } from '../overlay/mount';
import { isPopoverChild, PopoverScope } from '../overlay/popover-scope';
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
  /** Anchor the panel to another element (for example a whole field) instead of the trigger. */
  anchorRef?: () => HTMLElement | undefined;
  /** Trap focus and block outside interaction while open. */
  modal?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
}

export function Popover(props: PopoverProps) {
  const mount = useOverlayMount();
  const parents = useContext(PopoverScope);
  const owner = createUniqueId();
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
      anchorRef={props.anchorRef}
    >
      <KobaltePopover.Trigger as={props.trigger} />
      <KobaltePopover.Portal mount={mount}>
        <KobaltePopover.Content
          data-vesta="popover"
          data-vesta-popover-owner={parents.join(' ') || undefined}
          class={props.class}
          style={props.style}
          onInteractOutside={(event) => {
            if (event.target instanceof Element && isPopoverChild(event.target, owner)) event.preventDefault();
          }}
        >
          <Show when={title()}>
            <KobaltePopover.Title data-vesta="popover-title">{title()}</KobaltePopover.Title>
          </Show>
          <Show when={description()}>
            <KobaltePopover.Description data-vesta="popover-description">{description()}</KobaltePopover.Description>
          </Show>
          <PopoverScope value={[owner, ...parents]}>{props.children}</PopoverScope>
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </KobaltePopover>
  );
}
