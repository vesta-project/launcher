import { Select as KobalteSelect } from '@kobalte/core/select';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import type { ControlSize } from '../../foundation/types';
import { CheckGlyph, ChevronDownGlyph } from '../../internal/icons';
import { useOverlayMount } from '../overlay/mount';
import type { Placement } from '../overlay/types';
import '../field/field.css';
import '../overlay/overlay.css';
import '../menu/menu.css';
import './select.css';

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary line under the label in the list. */
  description?: string;
  icon?: JSX.Element;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  label?: JSX.Element;
  description?: JSX.Element;
  /** Error message. When present the field is marked invalid. */
  error?: JSX.Element;
  placeholder?: string;
  size?: ControlSize;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  placement?: Placement;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

export function Select(props: SelectProps) {
  const mount = useOverlayMount();
  const label = children(() => props.label);
  const description = children(() => props.description);
  const error = children(() => props.error);
  const find = (value: string | undefined) => props.options.find((option) => option.value === value);

  return (
    <KobalteSelect<SelectOption>
      data-vesta="field"
      data-size={props.size ?? 'md'}
      class={props.class}
      style={props.style}
      // Omit unset id — Kobalte stringifies undefined into the literal "undefined".
      {...(props.id != null ? { id: props.id } : {})}
      name={props.name}
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      optionDisabled="disabled"
      {...(props.value !== undefined ? { value: find(props.value) ?? null } : {})}
      {...(props.value === undefined && props.defaultValue !== undefined
        ? { defaultValue: find(props.defaultValue) }
        : {})}
      onChange={(option) => option && props.onChange?.(option.value)}
      placeholder={props.placeholder ?? 'Select…'}
      disabled={props.disabled}
      required={props.required}
      validationState={error() == null ? 'valid' : 'invalid'}
      placement={props.placement ?? 'bottom-start'}
      gutter={4}
      itemComponent={(itemProps) => (
        <KobalteSelect.Item item={itemProps.item} data-vesta="select-item">
          <span data-vesta="menu-item-icon" aria-hidden="true">
            <KobalteSelect.ItemIndicator data-vesta="select-item-indicator">
              <CheckGlyph />
            </KobalteSelect.ItemIndicator>
          </span>
          <span data-vesta="select-item-text">
            <KobalteSelect.ItemLabel data-vesta="select-item-label">
              <Show when={itemProps.item.rawValue.icon}>
                <span data-vesta="select-item-icon" aria-hidden="true">
                  {itemProps.item.rawValue.icon}
                </span>
              </Show>
              {itemProps.item.rawValue.label}
            </KobalteSelect.ItemLabel>
            <Show when={itemProps.item.rawValue.description}>
              <KobalteSelect.ItemDescription data-vesta="select-item-description">
                {itemProps.item.rawValue.description}
              </KobalteSelect.ItemDescription>
            </Show>
          </span>
        </KobalteSelect.Item>
      )}
    >
      <Show when={label()}>
        <KobalteSelect.Label data-vesta="field-label">{label()}</KobalteSelect.Label>
      </Show>
      <KobalteSelect.HiddenSelect />
      <KobalteSelect.Trigger data-vesta="field-control" aria-label={props['aria-label']}>
        <KobalteSelect.Value<SelectOption> data-vesta="select-value">
          {(state) => (
            <>
              <Show when={state.selectedOption()?.icon}>
                <span data-vesta="field-icon" aria-hidden="true">
                  {state.selectedOption()?.icon}
                </span>
              </Show>
              <span data-vesta="select-value-text">{state.selectedOption()?.label}</span>
            </>
          )}
        </KobalteSelect.Value>
        <KobalteSelect.Icon data-vesta="select-chevron">
          <ChevronDownGlyph />
        </KobalteSelect.Icon>
      </KobalteSelect.Trigger>
      <Show when={description()}>
        <KobalteSelect.Description data-vesta="field-description">{description()}</KobalteSelect.Description>
      </Show>
      <Show when={error()}>
        <KobalteSelect.ErrorMessage data-vesta="field-error">{error()}</KobalteSelect.ErrorMessage>
      </Show>
      <KobalteSelect.Portal mount={mount}>
        <KobalteSelect.Content data-vesta="select-content">
          <KobalteSelect.Listbox data-vesta="select-listbox" />
        </KobalteSelect.Content>
      </KobalteSelect.Portal>
    </KobalteSelect>
  );
}
