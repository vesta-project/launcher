import { Tabs as KobalteTabs } from '@kobalte/core/tabs';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import './tabs.css';

export interface TabsProps {
  /** Selected tab value (controlled). */
  value?: string;
  /** Initially selected tab value (uncontrolled). Defaults to the first enabled tab. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** `vertical` puts the list beside the panels, e.g. for a settings page. */
  orientation?: 'horizontal' | 'vertical';
  size?: 'sm' | 'md';
  id?: string;
  class?: string;
  style?: JSX.CSSProperties;
  /** A `TabList` followed by one `TabPanel` per tab. */
  children?: JSX.Element;
}

/** Navigation between panels of content; the selected tab carries an underline. */
export function Tabs(props: TabsProps) {
  const orientation = () => props.orientation ?? 'horizontal';
  // Controlled callers (including routes) only need actual value changes.
  const change = (value: string) => {
    if (value !== props.value) props.onChange?.(value);
  };

  return (
    <KobalteTabs
      data-vesta="tabs"
      data-tone="accent"
      data-size={props.size ?? 'md'}
      data-orientation={orientation()}
      // Omit unset id — Kobalte stringifies undefined into the literal "undefined".
      {...(props.id != null ? { id: props.id } : {})}
      class={props.class}
      style={props.style}
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={change}
      orientation={orientation()}
    >
      {props.children}
    </KobalteTabs>
  );
}

export interface TabListProps {
  /** Accessible name for the list when the surrounding heading doesn't provide one. */
  'aria-label'?: string;
  class?: string;
  style?: JSX.CSSProperties;
  /** `Tab` elements. */
  children?: JSX.Element;
}

export function TabList(props: TabListProps) {
  return (
    <KobalteTabs.List data-vesta="tab-list" aria-label={props['aria-label']} class={props.class} style={props.style}>
      {props.children}
      <KobalteTabs.Indicator data-vesta="tab-indicator" />
    </KobalteTabs.List>
  );
}

export interface TabProps {
  /** Identifies the tab and its panel. */
  value: string;
  disabled?: boolean;
  /** Icon before the label. */
  icon?: JSX.Element;
  /** End slot, e.g. a count `Badge`. */
  badge?: JSX.Element;
  class?: string;
  children?: JSX.Element;
}

export function Tab(props: TabProps) {
  // Slots are resolved once; reading a JSX prop twice would create it twice.
  const icon = children(() => props.icon);
  const label = children(() => props.children);
  const badge = children(() => props.badge);

  return (
    <KobalteTabs.Trigger data-vesta="tab" value={props.value} disabled={props.disabled} class={props.class}>
      <Show when={icon()}>
        <span data-vesta="tab-icon" aria-hidden="true">
          {icon()}
        </span>
      </Show>
      <span data-vesta="tab-label">{label()}</span>
      <Show when={badge()}>
        <span data-vesta="tab-badge">{badge()}</span>
      </Show>
    </KobalteTabs.Trigger>
  );
}

export interface TabPanelProps {
  /** The `value` of the tab that shows this panel. */
  value: string;
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

export function TabPanel(props: TabPanelProps) {
  return (
    <KobalteTabs.Content data-vesta="tab-panel" value={props.value} class={props.class} style={props.style}>
      {props.children}
    </KobalteTabs.Content>
  );
}
