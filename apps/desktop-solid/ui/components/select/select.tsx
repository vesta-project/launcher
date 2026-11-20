import { Select as KobalteSelect } from "@kobalte/core/select";
import type { JSX } from "@solidjs/web";
import { children, createMemo, createSignal, Show, untrack, useContext } from "solid-js";
import { LONG_LIST, PAGE_SIZE, boundOptions, nearEnd } from "../combobox/options";
import type { ControlSize } from "../../foundation/types";
import { CheckGlyph, ChevronDownGlyph } from "../../internal/icons";
import { useOverlayMount } from "../overlay/mount";
import { PopoverScope } from "../overlay/popover-scope";
import type { Placement } from "../overlay/types";
import "../field/field.css";
import "../overlay/overlay.css";
import "../menu/menu.css";
import "./select.css";

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary line under the label in the list. */
  description?: JSX.Element;
  /**
   * Shown in the list and, for the selected option, in the trigger. Pass a function for
   * markup such as an `<img>`: a single node can only sit in one place, so a plain element
   * would vanish from the trigger once the list has rendered it.
   */
  icon?: JSX.Element | (() => JSX.Element);
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  /** Options drawn per page for long lists (default 30 past 60 options); more as the menu scrolls. */
  pageSize?: number;
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
  "aria-label"?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

const renderIcon = (icon: SelectOption['icon']) => (typeof icon === 'function' ? icon() : icon);

export function Select(props: SelectProps) {
  const mount = useOverlayMount();
  const popoverOwners = useContext(PopoverScope);
  const label = children(() => props.label);
  const description = children(() => props.description);
  const error = children(() => props.error);
  // Keep option identities stable across reads, including callers with mapped JSX props.
  const options = createMemo(() => props.options);
  // JSX getters may create compiler-owned computations. Evaluate them in our
  // owned memo, never for the first time inside Kobalte's effect callback.
  const value = createMemo(() => props.value);
  const find = (value: string | undefined) =>
    options().find((option) => option.value === value);
  // Long lists are drawn a page at a time (see combobox/options.ts); the chosen option is
  // always in the collection so the trigger keeps its label.
  const [pages, setPages] = createSignal(1, { name: "selectPages" });
  const pageSize = () => props.pageSize ?? (options().length > LONG_LIST ? PAGE_SIZE : undefined);
  const selected = createMemo(() => find(value()), { name: "selectSelected" });
  const displayed = createMemo(() => {
    const size = pageSize();
    return size === undefined ? options() : boundOptions(options(), () => true, selected(), size * pages());
  }, { name: "selectCollection" });
  const revealMore = (event: Event & { currentTarget: HTMLDivElement }) => {
    const size = untrack(pageSize);
    if (size !== undefined && size * untrack(pages) < untrack(options).length && nearEnd(event.currentTarget)) {
      setPages((count) => count + 1);
    }
  };

  return (
    <KobalteSelect<SelectOption>
      data-vesta="field"
      data-size={props.size ?? "md"}
      class={props.class}
      style={props.style}
      // Omit unset id — Kobalte stringifies undefined into the literal "undefined".
      {...(props.id != null ? { id: props.id } : {})}
      name={props.name}
      options={displayed()}
      onOpenChange={(open) => { if (!open) setPages(1); }}
      optionValue="value"
      optionTextValue="label"
      optionDisabled="disabled"
      {...(value() !== undefined
        ? { value: selected() ?? null }
        : {})}
      {...(value() === undefined && props.defaultValue !== undefined
        ? { defaultValue: find(props.defaultValue) }
        : {})}
      onChange={(option) => {
        // Controlled selection synchronization must not echo an unchanged value.
        if (option && option.value !== untrack(value))
          props.onChange?.(option.value);
      }}
      placeholder={props.placeholder ?? "Select…"}
      disabled={props.disabled}
      required={props.required}
      validationState={error() == null ? "valid" : "invalid"}
      placement={props.placement ?? "bottom-start"}
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
                  {renderIcon(itemProps.item.rawValue.icon)}
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
        <KobalteSelect.Label data-vesta="field-label">
          {label()}
        </KobalteSelect.Label>
      </Show>
      <KobalteSelect.HiddenSelect />
      <KobalteSelect.Trigger
        data-vesta="field-control"
        aria-label={props["aria-label"]}
      >
        <KobalteSelect.Value<SelectOption> data-vesta="select-value">
          {(state) => (
            <>
              <Show when={state.selectedOption()?.icon}>
                <span data-vesta="field-icon" aria-hidden="true">
                  {renderIcon(state.selectedOption()?.icon)}
                </span>
              </Show>
              <span data-vesta="select-value-text">
                {state.selectedOption()?.label}
              </span>
            </>
          )}
        </KobalteSelect.Value>
        <KobalteSelect.Icon data-vesta="select-chevron">
          <ChevronDownGlyph />
        </KobalteSelect.Icon>
      </KobalteSelect.Trigger>
      <Show when={description()}>
        <KobalteSelect.Description data-vesta="field-description">
          {description()}
        </KobalteSelect.Description>
      </Show>
      <Show when={error()}>
        <KobalteSelect.ErrorMessage data-vesta="field-error">
          {error()}
        </KobalteSelect.ErrorMessage>
      </Show>
      <KobalteSelect.Portal mount={mount}>
        <KobalteSelect.Content data-vesta="select-content" onScroll={revealMore} data-vesta-popover-owner={popoverOwners.join(' ') || undefined}>
          <KobalteSelect.Listbox data-vesta="select-listbox" />
        </KobalteSelect.Content>
      </KobalteSelect.Portal>
    </KobalteSelect>
  );
}
