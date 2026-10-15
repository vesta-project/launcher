import { ContextMenu as KobalteContextMenu } from '@kobalte/core/context-menu';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import type { Tone } from '../../foundation/types';
import { CheckGlyph, ChevronRightGlyph } from '../../internal/icons';
import { useOverlayMount } from '../overlay/mount';
import type { TriggerRender } from '../overlay/types';
import '../overlay/overlay.css';
import '../separator/separator.css';
import '../menu/menu.css';

export interface ContextMenuProps {
  /** Element that opens the menu on right-click / long-press. */
  trigger: TriggerRender;
  children: JSX.Element;
  /** Context menus are pointer-anchored; open state is not controlled. */
  onOpenChange?: (open: boolean) => void;
}

export function ContextMenu(props: ContextMenuProps) {
  const mount = useOverlayMount();
  return (
    <KobalteContextMenu onOpenChange={props.onOpenChange} gutter={4}>
      <KobalteContextMenu.Trigger as={props.trigger} />
      <KobalteContextMenu.Portal mount={mount}>
        <KobalteContextMenu.Content data-vesta="menu">{props.children}</KobalteContextMenu.Content>
      </KobalteContextMenu.Portal>
    </KobalteContextMenu>
  );
}

export interface ContextMenuItemProps {
  children: JSX.Element;
  icon?: JSX.Element;
  /** Display-only shortcut hint, e.g. "⌘D". Key handling belongs to the app. */
  shortcut?: string;
  /** `danger` for destructive actions. Defaults to `neutral`. */
  tone?: Extract<Tone, 'neutral' | 'danger'>;
  onSelect?: () => void;
  disabled?: boolean;
  /** Keep the menu open after selection. */
  keepOpen?: boolean;
  /** Typeahead text when the label is not plain text. */
  textValue?: string;
}

export function ContextMenuItem(props: ContextMenuItemProps) {
  const icon = children(() => props.icon);
  return (
    <KobalteContextMenu.Item
      data-vesta="menu-item"
      data-tone={props.tone ?? 'neutral'}
      onSelect={props.onSelect}
      disabled={props.disabled}
      closeOnSelect={!props.keepOpen}
      textValue={props.textValue}
    >
      <span data-vesta="menu-item-icon" aria-hidden="true">
        {icon()}
      </span>
      <KobalteContextMenu.ItemLabel data-vesta="menu-item-label">{props.children}</KobalteContextMenu.ItemLabel>
      <Show when={props.shortcut}>
        <kbd data-vesta="menu-item-shortcut">{props.shortcut}</kbd>
      </Show>
    </KobalteContextMenu.Item>
  );
}

export interface ContextMenuCheckboxItemProps {
  children: JSX.Element;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Close the menu after toggling. Checkbox items stay open by default. */
  closeOnSelect?: boolean;
}

export function ContextMenuCheckboxItem(props: ContextMenuCheckboxItemProps) {
  return (
    <KobalteContextMenu.CheckboxItem
      data-vesta="menu-item"
      data-tone="neutral"
      checked={props.checked}
      defaultChecked={props.defaultChecked}
      onChange={props.onChange}
      disabled={props.disabled}
      closeOnSelect={props.closeOnSelect ?? false}
    >
      <span data-vesta="menu-item-icon" aria-hidden="true">
        <KobalteContextMenu.ItemIndicator data-vesta="menu-item-indicator">
          <CheckGlyph />
        </KobalteContextMenu.ItemIndicator>
      </span>
      <KobalteContextMenu.ItemLabel data-vesta="menu-item-label">{props.children}</KobalteContextMenu.ItemLabel>
    </KobalteContextMenu.CheckboxItem>
  );
}

export interface ContextMenuRadioGroupProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  children: JSX.Element;
}

export function ContextMenuRadioGroup(props: ContextMenuRadioGroupProps) {
  return (
    <KobalteContextMenu.RadioGroup
      {...(props.value !== undefined ? { value: props.value } : {})}
      {...(props.value === undefined && props.defaultValue !== undefined ? { defaultValue: props.defaultValue } : {})}
      onChange={props.onChange}
    >
      {props.children}
    </KobalteContextMenu.RadioGroup>
  );
}

export interface ContextMenuRadioItemProps {
  value: string;
  children: JSX.Element;
  disabled?: boolean;
}

export function ContextMenuRadioItem(props: ContextMenuRadioItemProps) {
  return (
    <KobalteContextMenu.RadioItem data-vesta="menu-item" data-tone="neutral" value={props.value} disabled={props.disabled}>
      <span data-vesta="menu-item-icon" aria-hidden="true">
        <KobalteContextMenu.ItemIndicator data-vesta="menu-item-indicator">
          <RadioGlyph />
        </KobalteContextMenu.ItemIndicator>
      </span>
      <KobalteContextMenu.ItemLabel data-vesta="menu-item-label">{props.children}</KobalteContextMenu.ItemLabel>
    </KobalteContextMenu.RadioItem>
  );
}

function RadioGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
    </svg>
  );
}

export function ContextMenuGroup(props: { label?: JSX.Element; children: JSX.Element }) {
  const label = children(() => props.label);
  return (
    <KobalteContextMenu.Group data-vesta="menu-group">
      <Show when={label()}>
        <KobalteContextMenu.GroupLabel data-vesta="menu-group-label">{label()}</KobalteContextMenu.GroupLabel>
      </Show>
      {props.children}
    </KobalteContextMenu.Group>
  );
}

export function ContextMenuSeparator() {
  return <KobalteContextMenu.Separator data-vesta="separator" />;
}

export interface ContextMenuSubProps {
  label: JSX.Element;
  icon?: JSX.Element;
  children: JSX.Element;
  disabled?: boolean;
}

/** Nested menu opened from an item. */
export function ContextMenuSub(props: ContextMenuSubProps) {
  const mount = useOverlayMount();
  const icon = children(() => props.icon);
  return (
    <KobalteContextMenu.Sub overlap gutter={4} shift={-5}>
      <KobalteContextMenu.SubTrigger data-vesta="menu-item" data-tone="neutral" disabled={props.disabled}>
        <span data-vesta="menu-item-icon" aria-hidden="true">
          {icon()}
        </span>
        <span data-vesta="menu-item-label">{props.label}</span>
        <span data-vesta="menu-item-chevron" aria-hidden="true">
          <ChevronRightGlyph />
        </span>
      </KobalteContextMenu.SubTrigger>
      <KobalteContextMenu.Portal mount={mount}>
        <KobalteContextMenu.SubContent data-vesta="menu">{props.children}</KobalteContextMenu.SubContent>
      </KobalteContextMenu.Portal>
    </KobalteContextMenu.Sub>
  );
}
