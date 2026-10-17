import { Switch } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { For, Show } from 'solid-js';
import { Icon } from '../../components/icon';
import { SettingRow } from '../../components/setting-row';
import './parts.css';

/** A titled, raised group of settings rows. */
export function Card(props: {
  title?: string;
  description?: string;
  /** Controls in the card's header, right-aligned. */
  action?: JSX.Element;
  danger?: boolean;
  children: JSX.Element;
}) {
  return (
    <section data-vesta="prefs-card" data-danger={props.danger ? '' : undefined}>
      <Show when={props.title}>
        <header data-vesta="prefs-card-header">
          <div>
            <h3>{props.title}</h3>
            <Show when={props.description}>
              <p>{props.description}</p>
            </Show>
          </div>
          <Show when={props.action}>
            <div data-vesta="prefs-card-action">{props.action}</div>
          </Show>
        </header>
      </Show>
      <div data-vesta="prefs-card-body">{props.children}</div>
    </section>
  );
}

/** A setting whose control is a switch. */
export function ToggleRow(props: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SettingRow label={props.label} description={props.description}>
      <Switch
        size="sm"
        aria-label={props.label}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </SettingRow>
  );
}

/** An inline note: neutral, warning, danger or success. */
export function Callout(props: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  icon?: string;
  children: JSX.Element;
}) {
  return (
    <p data-vesta="prefs-callout" data-tone={props.tone ?? 'info'} role={props.tone === 'danger' ? 'alert' : undefined}>
      <Icon
        name={
          props.icon ??
          (props.tone === 'danger' || props.tone === 'warning' ? 'icons/controls/warning' : 'icons/status/info')
        }
        size={14}
      />
      <span>{props.children}</span>
    </p>
  );
}

/** Fields shown only while a parent option is on, inset under it. */
export function Reveal(props: { children: JSX.Element }) {
  return <div data-vesta="prefs-reveal">{props.children}</div>;
}

/** One key combination, drawn as keycaps. */
export function Keycaps(props: { keys: string[] }) {
  return (
    <span data-vesta="prefs-keys">
      <For each={props.keys}>{(key) => <kbd>{key}</kbd>}</For>
    </span>
  );
}
