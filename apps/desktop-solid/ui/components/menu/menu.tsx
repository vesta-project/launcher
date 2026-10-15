import { DropdownMenu as KobalteMenu } from '@kobalte/core/dropdown-menu';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import type { Tone } from '../../foundation/types';
import { CheckGlyph, ChevronRightGlyph } from '../../internal/icons';
import { useOverlayMount } from '../overlay/mount';
import type { Placement, TriggerRender } from '../overlay/types';
import '../overlay/overlay.css';
import '../separator/separator.css';
import './menu.css';

export interface MenuProps {
  trigger: TriggerRender;
  children: JSX.Element;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
}

export function Menu(props: MenuProps) {
  const mount = useOverlayMount();
  return (
    <KobalteMenu
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={props.onOpenChange}
      placement={props.placement ?? 'bottom-start'}
      gutter={4}
    >
      <KobalteMenu.Trigger as={props.trigger} />
      <KobalteMenu.Portal mount={mount}>
        <KobalteMenu.Content data-vesta="menu">{props.children}</KobalteMenu.Content>
      </KobalteMenu.Portal>
    </KobalteMenu>
  );
}

export interface MenuItemProps {
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

export function MenuItem(props: MenuItemProps) {
  const icon = children(() => props.icon);
  return (
    <KobalteMenu.Item
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
      <KobalteMenu.ItemLabel data-vesta="menu-item-label">{props.children}</KobalteMenu.ItemLabel>
      <Show when={props.shortcut}>
        <kbd data-vesta="menu-item-shortcut">{props.shortcut}</kbd>
      </Show>
    </KobalteMenu.Item>
  );
}

export interface MenuCheckboxItemProps {
  children: JSX.Element;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Close the menu after toggling. Checkbox items stay open by default. */
  closeOnSelect?: boolean;
}

export function MenuCheckboxItem(props: MenuCheckboxItemProps) {
  return (
    <KobalteMenu.CheckboxItem
      data-vesta="menu-item"
      data-tone="neutral"
      checked={props.checked}
      defaultChecked={props.defaultChecked}
      onChange={props.onChange}
      disabled={props.disabled}
      closeOnSelect={props.closeOnSelect ?? false}
    >
      <span data-vesta="menu-item-icon" aria-hidden="true">
        <KobalteMenu.ItemIndicator data-vesta="menu-item-indicator">
          <CheckGlyph />
        </KobalteMenu.ItemIndicator>
      </span>
      <KobalteMenu.ItemLabel data-vesta="menu-item-label">{props.children}</KobalteMenu.ItemLabel>
    </KobalteMenu.CheckboxItem>
  );
}

export function MenuGroup(props: { label?: JSX.Element; children: JSX.Element }) {
  const label = children(() => props.label);
  return (
    <KobalteMenu.Group data-vesta="menu-group">
      <Show when={label()}>
        <KobalteMenu.GroupLabel data-vesta="menu-group-label">{label()}</KobalteMenu.GroupLabel>
      </Show>
      {props.children}
    </KobalteMenu.Group>
  );
}

export function MenuSeparator() {
  return <KobalteMenu.Separator data-vesta="separator" />;
}

export interface MenuSubProps {
  label: JSX.Element;
  icon?: JSX.Element;
  children: JSX.Element;
  disabled?: boolean;
}

/** Nested menu opened from an item. */
export function MenuSub(props: MenuSubProps) {
  const mount = useOverlayMount();
  const icon = children(() => props.icon);
  return (
    <KobalteMenu.Sub overlap gutter={4} shift={-5}>
      <KobalteMenu.SubTrigger data-vesta="menu-item" data-tone="neutral" disabled={props.disabled}>
        <span data-vesta="menu-item-icon" aria-hidden="true">
          {icon()}
        </span>
        <span data-vesta="menu-item-label">{props.label}</span>
        <span data-vesta="menu-item-chevron" aria-hidden="true">
          <ChevronRightGlyph />
        </span>
      </KobalteMenu.SubTrigger>
      <KobalteMenu.Portal mount={mount}>
        <KobalteMenu.SubContent data-vesta="menu">{props.children}</KobalteMenu.SubContent>
      </KobalteMenu.Portal>
    </KobalteMenu.Sub>
  );
}
