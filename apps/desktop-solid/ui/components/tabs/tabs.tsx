import { Tabs as KobalteTabs, useTabsContext } from '@kobalte/core/tabs';
import type { JSX } from '@solidjs/web';
import { children, createEffect, createSignal, Show } from 'solid-js';
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
  /** Render immediately when an external owner controls mounting, without presence delays. */
  forceMount?: boolean;
  /** The `value` of the tab that shows this panel. */
  value: string;
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

/** Anything that takes Tab focus by itself; hidden-ness is deliberately not checked (see below). */
const TABBABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * Kobalte's `Tabs.Content`, minus its per-mutation tabbable scan. That scan runs
 * `getComputedStyle` from a MutationObserver on every DOM change inside the panel, forcing a
 * synchronous style recalc each time; in virtual lists (Resources, Files) it was a third of
 * every scroll frame. Here the panel only needs to know whether it holds a focus stop at all, so
 * a selector check runs at most once per idle period and never reads styles.
 */
export function TabPanel(props: TabPanelProps) {
  const context = useTabsContext();
  const [element, setElement] = createSignal<HTMLDivElement | undefined>(undefined, { name: 'tab-panel:element' });
  const [focusStop, setFocusStop] = createSignal(false, { name: 'tab-panel:focus-stop' });
  const selected = () => context.listState().selectedKey() === props.value;
  const id = () => context.generateContentId(props.value);
  createEffect(() => [props.value, id()] as const, ([value, contentId]) => { context.contentIdsMap().set(value, contentId); });
  createEffect(element, (panel) => {
    if (!panel) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const check = () => { pending = undefined; setFocusStop(!panel.querySelector(TABBABLE)); };
    const schedule = () => { if (pending === undefined) pending = setTimeout(check, 120); };
    check();
    const observer = new MutationObserver(schedule);
    observer.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex', 'disabled', 'href'] });
    return () => { observer.disconnect(); clearTimeout(pending); };
  });
  return (
    <Show when={props.forceMount || selected()}>
      <div
        ref={setElement}
        data-vesta="tab-panel"
        role="tabpanel"
        id={id()}
        tabindex={focusStop() ? 0 : undefined}
        aria-labelledby={context.triggerIdsMap().get(props.value)}
        data-orientation={context.orientation()}
        data-selected={selected() ? '' : undefined}
        class={props.class}
        style={props.style}
      >
        {props.children}
      </div>
    </Show>
  );
}
