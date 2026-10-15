import { Button as KobalteButton } from '@kobalte/core/button';
import type { JSX } from '@solidjs/web';
import { children, omit, Show } from 'solid-js';
import type { ControlSize, Tone } from '../../foundation/types';
import { mergeElementProps } from '../../internal/props';
import type { Placement, TriggerProps } from '../overlay/types';
import { Tooltip } from '../tooltip/tooltip';
import './button.css';

export type ButtonVariant = 'solid' | 'outline' | 'ghost';

export interface ButtonProps
  extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'disabled' | 'type' | 'tabindex'> {
  disabled?: boolean;
  /** Defaults to `button`, so a button inside a form never submits by accident. */
  type?: 'button' | 'submit' | 'reset';
  tabindex?: number | string;
  /** Fill treatment. Defaults to `solid`. */
  variant?: ButtonVariant;
  /** Semantic colour. Defaults to `neutral`; use `accent` for the primary action. */
  tone?: Tone;
  size?: ControlSize;
  /** Icon before the label. */
  icon?: JSX.Element;
  /** Icon after the label, e.g. a disclosure chevron. */
  iconEnd?: JSX.Element;
  children?: JSX.Element;
}

const LOCAL_PROPS = ['variant', 'tone', 'size', 'icon', 'iconEnd', 'children'] as const;

export function Button(props: ButtonProps) {
  // Defaults use `??` rather than merge(): callers forwarding an optional prop
  // pass an explicit `undefined`, which merge() treats as a real value.
  const rest = omit(props, ...LOCAL_PROPS);
  // Slots are resolved once; reading a JSX prop twice would create it twice.
  const icon = children(() => props.icon);
  const iconEnd = children(() => props.iconEnd);
  const label = children(() => props.children);
  const iconOnly = () => icon() != null && label() == null;

  return (
    <KobalteButton
      {...rest}
      data-vesta="button"
      data-variant={props.variant ?? 'solid'}
      data-tone={props.tone ?? 'neutral'}
      data-size={props.size ?? 'md'}
      data-icon-only={iconOnly() ? '' : undefined}
    >
      <Show when={icon()}>
        <span data-vesta="button-icon" data-slot="start" aria-hidden="true">
          {icon()}
        </span>
      </Show>
      <Show when={label()}>
        <span data-vesta="button-label">{label()}</span>
      </Show>
      <Show when={iconEnd()}>
        <span data-vesta="button-icon" data-slot="end" aria-hidden="true">
          {iconEnd()}
        </span>
      </Show>
    </KobalteButton>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'iconEnd' | 'children'> {
  icon: JSX.Element;
  /** Accessible name. Required because the button has no visible text. */
  label: string;
  /** Show the label as a tooltip on hover/focus. Defaults to true. */
  tooltip?: boolean;
  tooltipPlacement?: Placement;
}

/** Square button with only an icon; its label doubles as the tooltip. */
export function IconButton(props: IconButtonProps) {
  const rest = omit(props, 'label', 'tooltip', 'tooltipPlacement');
  // When the button is also another overlay's trigger, combine both sets of
  // trigger props so handlers chain and refs merge instead of overwriting.
  const render = (triggerProps?: TriggerProps) => (
    <Button
      {...(triggerProps ? mergeElementProps<ButtonProps>(rest as TriggerProps, triggerProps) : rest)}
      aria-label={props.label}
    />
  );

  return (
    <Show when={props.tooltip !== false} fallback={render()}>
      <Tooltip content={props.label} placement={props.tooltipPlacement} trigger={render} />
    </Show>
  );
}
