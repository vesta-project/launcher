import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import type { JSX } from '@solidjs/web';
import { useOverlayMount } from '../overlay/mount';
import type { Placement, TriggerRender } from '../overlay/types';
import '../overlay/overlay.css';
import './tooltip.css';

export interface TooltipProps {
  /** Supplementary text. It does not replace the trigger's accessible name. */
  content: JSX.Element;
  trigger: TriggerRender;
  placement?: Placement;
  /** Milliseconds before showing. Defaults to 500. */
  openDelay?: number;
  disabled?: boolean;
}

export function Tooltip(props: TooltipProps) {
  const mount = useOverlayMount();
  return (
    <KobalteTooltip
      placement={props.placement ?? 'top'}
      gutter={6}
      openDelay={props.openDelay ?? 500}
      closeDelay={0}
      disabled={props.disabled}
    >
      <KobalteTooltip.Trigger as={props.trigger} />
      <KobalteTooltip.Portal mount={mount}>
        <KobalteTooltip.Content data-vesta="tooltip">{props.content}</KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
}
