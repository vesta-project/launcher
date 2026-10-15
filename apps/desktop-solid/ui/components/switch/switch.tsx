import { Switch as KobalteSwitch } from '@kobalte/core/switch';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import type { ControlSize } from '../../foundation/types';
import '../field/field.css';
import '../choice/choice.css';
import './switch.css';

export interface SwitchProps {
  label?: JSX.Element;
  description?: JSX.Element;
  /** Error message. When present the switch is marked invalid. */
  error?: JSX.Element;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  size?: ControlSize;
  id?: string;
  class?: string;
  style?: JSX.CSSProperties;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
}

export function Switch(props: SwitchProps) {
  // Slots are resolved once; reading a JSX prop twice would create it twice.
  const label = children(() => props.label);
  const description = children(() => props.description);
  const error = children(() => props.error);

  return (
    <KobalteSwitch
      data-vesta="switch"
      data-tone="accent"
      data-size={props.size ?? 'md'}
      class={props.class}
      style={props.style}
      // Omit unset id — Kobalte stringifies undefined into the literal "undefined".
      {...(props.id != null ? { id: props.id } : {})}
      name={props.name}
      value={props.value}
      checked={props.checked}
      defaultChecked={props.defaultChecked}
      onChange={props.onChange}
      disabled={props.disabled}
      readOnly={props.readOnly}
      required={props.required}
      validationState={error() == null ? 'valid' : 'invalid'}
    >
      <KobalteSwitch.Input aria-label={props['aria-label']} />
      <KobalteSwitch.Control data-vesta="switch-track">
        <KobalteSwitch.Thumb data-vesta="switch-thumb" />
      </KobalteSwitch.Control>
      <Show when={label()}>
        <KobalteSwitch.Label data-vesta="switch-label">{label()}</KobalteSwitch.Label>
      </Show>
      <Show when={description()}>
        <KobalteSwitch.Description data-vesta="field-description">{description()}</KobalteSwitch.Description>
      </Show>
      <KobalteSwitch.ErrorMessage data-vesta="field-error">{error()}</KobalteSwitch.ErrorMessage>
    </KobalteSwitch>
  );
}
