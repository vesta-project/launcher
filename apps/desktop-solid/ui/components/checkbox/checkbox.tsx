import { Checkbox as KobalteCheckbox } from '@kobalte/core/checkbox';
import type { JSX } from '@solidjs/web';
import { children, Show, untrack } from 'solid-js';
import { NativeChoice } from '../../internal/native-choice';
import type { ControlSize } from '../../foundation/types';
import { CheckGlyph, MinusGlyph } from '../../internal/icons';
import '../field/field.css';
import '../choice/choice.css';
import './checkbox.css';

export interface CheckboxProps {
  label?: JSX.Element;
  description?: JSX.Element;
  /** Error message. When present the checkbox is marked invalid. */
  error?: JSX.Element;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Presentational mixed state, e.g. a "select all" over partly selected children. */
  indeterminate?: boolean;
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

export function Checkbox(props: CheckboxProps) {
  // Checked with `in` so JSX slots aren't created just to look. A bare controlled checkbox (no label, text, error or mixed state), the kind lists repeat per
  // row, skips Kobalte for a native input with the same look.
  if (untrack(() => props.checked !== undefined && props.indeterminate === undefined && !('label' in props) && !('description' in props) && !('error' in props) && !props.readOnly && !props.required)) {
    return (
      <NativeChoice kind="checkbox" checked={!!props.checked} onChange={props.onChange} disabled={props.disabled}
        name={props.name} value={props.value} size={props.size} id={props.id} class={props.class} style={props.style}
        aria-label={props['aria-label']}>
        <span data-vesta="checkbox-control" data-checked={props.checked ? '' : undefined}>
          <Show when={props.checked}>
            <span data-vesta="checkbox-indicator"><CheckGlyph /></span>
          </Show>
        </span>
      </NativeChoice>
    );
  }
  // Slots are resolved once; reading a JSX prop twice would create it twice.
  const label = children(() => props.label);
  const description = children(() => props.description);
  const error = children(() => props.error);

  return (
    <KobalteCheckbox
      data-vesta="checkbox"
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
      indeterminate={props.indeterminate}
      disabled={props.disabled}
      readOnly={props.readOnly}
      required={props.required}
      validationState={error() == null ? 'valid' : 'invalid'}
    >
      <KobalteCheckbox.Input aria-label={props['aria-label']} />
      <KobalteCheckbox.Control data-vesta="checkbox-control">
        <KobalteCheckbox.Indicator data-vesta="checkbox-indicator">
          <Show when={props.indeterminate} fallback={<CheckGlyph />}>
            <MinusGlyph />
          </Show>
        </KobalteCheckbox.Indicator>
      </KobalteCheckbox.Control>
      <Show when={label()}>
        <KobalteCheckbox.Label data-vesta="checkbox-label">{label()}</KobalteCheckbox.Label>
      </Show>
      <Show when={description()}>
        <KobalteCheckbox.Description data-vesta="field-description">{description()}</KobalteCheckbox.Description>
      </Show>
      <Show when={error()}>
        <KobalteCheckbox.ErrorMessage data-vesta="field-error">{error()}</KobalteCheckbox.ErrorMessage>
      </Show>
    </KobalteCheckbox>
  );
}
