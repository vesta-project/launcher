import { TextField as KobalteTextField } from '@kobalte/core/text-field';
import type { JSX } from '@solidjs/web';
import { children, omit, Show } from 'solid-js';
import type { ControlSize } from '../../foundation/types';
import '../field/field.css';

type NativeInputProps = Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  | 'value' | 'defaultValue' | 'onChange' | 'onInput' | 'size' | 'disabled' | 'readOnly' | 'required' | 'name' | 'id' | 'children'
  | 'aria-label' | 'aria-labelledby' | 'aria-describedby'
> & {
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

export interface TextFieldProps extends NativeInputProps {
  label?: JSX.Element;
  description?: JSX.Element;
  /** Error message. When present the field is marked invalid. */
  error?: JSX.Element;
  /** Icon inside the box, before the text. */
  icon?: JSX.Element;
  size?: ControlSize;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
}

const ROOT_PROPS = [
  'label', 'description', 'error', 'icon', 'size', 'value', 'defaultValue',
  'onChange', 'id', 'name', 'disabled', 'readOnly', 'required', 'class', 'style',
] as const;

export function TextField(props: TextFieldProps) {
  const inputProps = omit(props, ...ROOT_PROPS);
  const icon = children(() => props.icon);
  const label = children(() => props.label);
  const description = children(() => props.description);
  const error = children(() => props.error);

  return (
    <KobalteTextField
      data-vesta="field"
      data-size={props.size ?? 'md'}
      class={props.class}
      style={props.style}
      // Omit unset id — Kobalte stringifies undefined into the literal "undefined".
      {...(props.id != null ? { id: props.id } : {})}
      name={props.name}
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={props.onChange}
      disabled={props.disabled}
      readOnly={props.readOnly}
      required={props.required}
      validationState={error() == null ? 'valid' : 'invalid'}
    >
      <Show when={label()}>
        <KobalteTextField.Label data-vesta="field-label">{label()}</KobalteTextField.Label>
      </Show>
      <div data-vesta="field-control">
        <Show when={icon()}>
          <span data-vesta="field-icon" aria-hidden="true">
            {icon()}
          </span>
        </Show>
        <KobalteTextField.Input {...inputProps} data-vesta="field-input" />
      </div>
      <Show when={description()}>
        <KobalteTextField.Description data-vesta="field-description">{description()}</KobalteTextField.Description>
      </Show>
      <KobalteTextField.ErrorMessage data-vesta="field-error">{error()}</KobalteTextField.ErrorMessage>
    </KobalteTextField>
  );
}
