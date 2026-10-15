import { NumberField as KobalteNumberField } from '@kobalte/core/number-field';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import type { ControlSize } from '../../foundation/types';
import { ChevronDownGlyph, ChevronUpGlyph } from '../../internal/icons';
import '../field/field.css';
import './number-field.css';

export interface NumberFieldProps {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: JSX.Element;
  description?: JSX.Element;
  /** Error message. When present the field is marked invalid. */
  error?: JSX.Element;
  size?: ControlSize;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  placeholder?: string;
  /** Hide the stepper buttons. */
  hideSteppers?: boolean;
  formatOptions?: Intl.NumberFormatOptions;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

export function NumberField(props: NumberFieldProps) {
  const label = children(() => props.label);
  const description = children(() => props.description);
  const error = children(() => props.error);

  return (
    <KobalteNumberField
      data-vesta="field"
      data-size={props.size ?? 'md'}
      class={props.class}
      style={props.style}
      {...(props.id != null ? { id: props.id } : {})}
      name={props.name}
      // Only pass the active value mode — undefined rawValue still looks controlled to Kobalte.
      {...(props.value !== undefined ? { rawValue: props.value } : {})}
      {...(props.value === undefined && props.defaultValue !== undefined ? { defaultValue: props.defaultValue } : {})}
      onRawValueChange={(value) => {
        if (Number.isNaN(value) || value === props.value) return;
        props.onChange?.(value);
      }}
      minValue={props.min}
      maxValue={props.max}
      step={props.step ?? 1}
      disabled={props.disabled}
      readOnly={props.readOnly}
      required={props.required}
      validationState={error() == null ? 'valid' : 'invalid'}
      format={props.formatOptions != null}
      formatOptions={props.formatOptions}
    >
      <Show when={label()}>
        <KobalteNumberField.Label data-vesta="field-label">{label()}</KobalteNumberField.Label>
      </Show>
      <div data-vesta="field-control">
        <KobalteNumberField.Input data-vesta="field-input" placeholder={props.placeholder} aria-label={props['aria-label']} />
        <Show when={!props.hideSteppers}>
          <div data-vesta="number-field-steppers">
            <KobalteNumberField.IncrementTrigger data-vesta="number-field-step" aria-label="Increment">
              <ChevronUpGlyph />
            </KobalteNumberField.IncrementTrigger>
            <KobalteNumberField.DecrementTrigger data-vesta="number-field-step" aria-label="Decrement">
              <ChevronDownGlyph />
            </KobalteNumberField.DecrementTrigger>
          </div>
        </Show>
      </div>
      <Show when={description()}>
        <KobalteNumberField.Description data-vesta="field-description">{description()}</KobalteNumberField.Description>
      </Show>
      <Show when={error()}>
        <KobalteNumberField.ErrorMessage data-vesta="field-error">{error()}</KobalteNumberField.ErrorMessage>
      </Show>
    </KobalteNumberField>
  );
}
