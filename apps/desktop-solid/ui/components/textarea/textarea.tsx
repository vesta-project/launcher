import { TextField as KobalteTextField } from '@kobalte/core/text-field';
import type { JSX } from '@solidjs/web';
import { children, omit, Show } from 'solid-js';
import type { ControlSize } from '../../foundation/types';
import '../field/field.css';
import './textarea.css';

type NativeTextAreaProps = Omit<
  JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
  | 'value'
  | 'defaultValue'
  | 'onChange'
  | 'onInput'
  | 'disabled'
  | 'readOnly'
  | 'required'
  | 'name'
  | 'id'
  | 'children'
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
> & {
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

export interface TextAreaProps extends NativeTextAreaProps {
  label?: JSX.Element;
  description?: JSX.Element;
  /** Error message. When present the field is marked invalid. */
  error?: JSX.Element;
  size?: ControlSize;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Visible rows. Defaults to 3. */
  rows?: number;
  /** Grow with content up to a max. Defaults to false. */
  autoResize?: boolean;
}

const ROOT_PROPS = [
  'label',
  'description',
  'error',
  'size',
  'value',
  'defaultValue',
  'onChange',
  'id',
  'name',
  'disabled',
  'readOnly',
  'required',
  'rows',
  'autoResize',
  'class',
  'style',
] as const;

export function TextArea(props: TextAreaProps) {
  const areaProps = omit(props, ...ROOT_PROPS);
  const label = children(() => props.label);
  const description = children(() => props.description);
  const error = children(() => props.error);

  return (
    <KobalteTextField
      data-vesta="field"
      data-size={props.size ?? 'md'}
      data-multiline=""
      class={props.class}
      style={props.style}
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
      <div data-vesta="field-control" data-multiline="">
        <KobalteTextField.TextArea
          {...areaProps}
          data-vesta="field-input"
          data-auto-resize={props.autoResize ? '' : undefined}
          rows={props.rows ?? 3}
          autoResize={props.autoResize}
        />
      </div>
      <Show when={description()}>
        <KobalteTextField.Description data-vesta="field-description">{description()}</KobalteTextField.Description>
      </Show>
      <KobalteTextField.ErrorMessage data-vesta="field-error">{error()}</KobalteTextField.ErrorMessage>
    </KobalteTextField>
  );
}
