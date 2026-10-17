import { SegmentedControl as KobalteSegmentedControl } from '@kobalte/core/segmented-control';
import type { JSX } from '@solidjs/web';
import { children, createUniqueId, For, Show } from 'solid-js';
import type { ControlSize } from '../../foundation/types';
import '../field/field.css';
import './segmented-control.css';

export interface SegmentedControlOption {
  value: string;
  label: string;
  /** Icon before the label. With `iconOnly` it is the only visible content. */
  icon?: JSX.Element;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  /** The 2–5 values to choose between. */
  options: SegmentedControlOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  size?: ControlSize;
  /** Show only the icons; labels stay as the accessible names. */
  iconOnly?: boolean;
  /** Items share the width equally and the control fills its container. */
  fill?: boolean;
  /** Visible label above the control. */
  label?: JSX.Element;
  disabled?: boolean;
  name?: string;
  id?: string;
  class?: string;
  style?: JSX.CSSProperties;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
}

/** Choose one value among a few options; a raised thumb slides under the selection. */
export function SegmentedControl(props: SegmentedControlProps) {
  // Slots are resolved once; reading a JSX prop twice would create it twice.
  const label = children(() => props.label);
  // Kobalte measures the thumb against its root, so the root is the track itself.
  // The label therefore lives beside it and names the group through aria-labelledby.
  const labelId = `segmented-label-${createUniqueId()}`;

  return (
    <div
      data-vesta="segmented-field"
      data-size={props.size ?? 'md'}
      data-fill={props.fill ? '' : undefined}
      class={props.class}
      style={props.style}
    >
      <Show when={label()}>
        <span data-vesta="field-label" id={labelId}>
          {label()}
        </span>
      </Show>
      <KobalteSegmentedControl
        data-vesta="segmented-control"
        data-size={props.size ?? 'md'}
        data-fill={props.fill ? '' : undefined}
        data-icon-only={props.iconOnly ? '' : undefined}
        // Omit unset id — Kobalte stringifies undefined into the literal "undefined".
        {...(props.id != null ? { id: props.id } : {})}
        name={props.name}
        value={props.value}
        defaultValue={props.defaultValue}
        onChange={props.onChange}
        disabled={props.disabled}
        aria-label={props['aria-label']}
        aria-labelledby={label() ? labelId : undefined}
      >
        <KobalteSegmentedControl.Indicator data-vesta="segmented-thumb" />
        <For each={props.options}>
          {(option) => {
            const icon = children(() => option.icon);
            return (
              <KobalteSegmentedControl.Item
                data-vesta="segmented-item"
                value={option.value}
                disabled={option.disabled}
                // Icon-only items still name themselves on hover.
                data-tip={props.iconOnly ? option.label : undefined}
              >
                <KobalteSegmentedControl.ItemInput />
                <Show when={icon()}>
                  <span data-vesta="segmented-icon" aria-hidden="true">
                    {icon()}
                  </span>
                </Show>
                <KobalteSegmentedControl.ItemLabel data-vesta="segmented-label">
                  {option.label}
                </KobalteSegmentedControl.ItemLabel>
              </KobalteSegmentedControl.Item>
            );
          }}
        </For>
      </KobalteSegmentedControl>
    </div>
  );
}
