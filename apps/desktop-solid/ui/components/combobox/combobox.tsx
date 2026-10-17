import { Combobox as KobalteCombobox } from '@kobalte/core/combobox';
import { createFilter } from '@kobalte/core/i18n';
import type { JSX } from '@solidjs/web';
import { children, Show, createSignal, useContext } from 'solid-js';
import type { ControlSize } from '../../foundation/types';
import { CheckGlyph, ChevronDownGlyph } from '../../internal/icons';
import { useOverlayMount } from '../overlay/mount';
import { PopoverScope } from '../overlay/popover-scope';
import type { Placement } from '../overlay/types';
import type { SelectOption } from '../select/select';
import '../field/field.css';
import '../overlay/overlay.css';
import '../menu/menu.css';
import '../select/select.css';
import './combobox.css';

export type ComboboxOption = SelectOption;

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Called as the filter text changes. */
  onInputChange?: (value: string) => void;
  label?: JSX.Element;
  description?: JSX.Element;
  /** Error message. When present the field is marked invalid. */
  error?: JSX.Element;
  placeholder?: string;
  size?: ControlSize;
  disabled?: boolean;
  required?: boolean;
  readOnly?: boolean;
  name?: string;
  id?: string;
  placement?: Placement;
  /** How options are filtered. Defaults to `contains`. */
  filter?: 'startsWith' | 'endsWith' | 'contains' | ((option: ComboboxOption, inputValue: string) => boolean);
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

export function Combobox(props: ComboboxProps) {
  const mount = useOverlayMount();
  const popoverOwners = useContext(PopoverScope);
  // A selected label is display text, not a search query. Only an actual input
  // event starts filtering; programmatic value/focus updates must not narrow it.
  const [query, setQuery] = createSignal<string | undefined>(undefined, { name: 'comboboxQuery' });
  let isOpen = false;
  const resetSearchForOpening = () => { if (!isOpen) setQuery(undefined); };
  const textFilter = createFilter({ sensitivity: 'base' });
  const matches = (option: ComboboxOption) => {
    const text = query();
    if (text === undefined) return true;
    const filter = props.filter ?? 'contains';
    return typeof filter === 'function' ? filter(option, text) : textFilter[filter](option.label, text);
  };
  const label = children(() => props.label);
  const description = children(() => props.description);
  const error = children(() => props.error);
  const find = (value: string | undefined) => props.options.find((option) => option.value === value);

  return (
    <KobalteCombobox<ComboboxOption>
      data-vesta="field"
      data-size={props.size ?? 'md'}
      class={props.class}
      style={props.style}
      {...(props.id != null ? { id: props.id } : {})}
      name={props.name}
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      optionLabel="label"
      optionDisabled="disabled"
      {...(props.value !== undefined ? { value: find(props.value) ?? null } : {})}
      {...(props.value === undefined && props.defaultValue !== undefined
        ? { defaultValue: find(props.defaultValue) }
        : {})}
      onChange={(option) => option && props.onChange?.(option.value)}
      onInputChange={props.onInputChange}
      placeholder={props.placeholder ?? 'Search…'}
      disabled={props.disabled}
      required={props.required}
      readOnly={props.readOnly}
      validationState={error() == null ? 'valid' : 'invalid'}
      defaultFilter={matches}
      onOpenChange={(open) => { isOpen = open; }}
      triggerMode="focus"
      placement={props.placement ?? 'bottom-start'}
      gutter={4}
      itemComponent={(itemProps) => (
        <KobalteCombobox.Item item={itemProps.item} data-vesta="select-item">
          <span data-vesta="menu-item-icon" aria-hidden="true">
            <KobalteCombobox.ItemIndicator data-vesta="select-item-indicator">
              <CheckGlyph />
            </KobalteCombobox.ItemIndicator>
          </span>
          <span data-vesta="select-item-text">
            <KobalteCombobox.ItemLabel data-vesta="select-item-label">
              <Show when={itemProps.item.rawValue.icon}>
                <span data-vesta="select-item-icon" aria-hidden="true">
                  {itemProps.item.rawValue.icon}
                </span>
              </Show>
              {itemProps.item.rawValue.label}
            </KobalteCombobox.ItemLabel>
            <Show when={itemProps.item.rawValue.description}>
              <KobalteCombobox.ItemDescription data-vesta="select-item-description">
                {itemProps.item.rawValue.description}
              </KobalteCombobox.ItemDescription>
            </Show>
          </span>
        </KobalteCombobox.Item>
      )}
    >
      <Show when={label()}>
        <KobalteCombobox.Label data-vesta="field-label">{label()}</KobalteCombobox.Label>
      </Show>
      <KobalteCombobox.HiddenSelect />
      <KobalteCombobox.Control data-vesta="field-control">
        <KobalteCombobox.Input data-vesta="field-input" aria-label={props['aria-label']} onInput={(event) => setQuery(event.currentTarget.value)}
          onFocus={resetSearchForOpening}
          onClick={resetSearchForOpening}
          onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') resetSearchForOpening(); }}
        />
        <KobalteCombobox.Trigger data-vesta="combobox-trigger" aria-label="Show options" onPointerDown={resetSearchForOpening}>
          <KobalteCombobox.Icon data-vesta="select-chevron">
            <ChevronDownGlyph />
          </KobalteCombobox.Icon>
        </KobalteCombobox.Trigger>
      </KobalteCombobox.Control>
      <Show when={description()}>
        <KobalteCombobox.Description data-vesta="field-description">{description()}</KobalteCombobox.Description>
      </Show>
      <Show when={error()}>
        <Show when={error()}>
          <KobalteCombobox.ErrorMessage data-vesta="field-error">{error()}</KobalteCombobox.ErrorMessage>
        </Show>
      </Show>
      <KobalteCombobox.Portal mount={mount}>
        <KobalteCombobox.Content data-vesta="select-content" data-vesta-popover-owner={popoverOwners.join(' ') || undefined}>
          <KobalteCombobox.Listbox data-vesta="select-listbox" />
        </KobalteCombobox.Content>
      </KobalteCombobox.Portal>
    </KobalteCombobox>
  );
}
