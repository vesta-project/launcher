import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import './setting-row.css';

/** A titled group of settings rows. */
export function SettingsSection(props: { title: string; description?: string; children: JSX.Element }) {
  return (
    <section data-vesta="settings-section">
      <header data-vesta="settings-section-header">
        <h2 data-vesta="settings-section-title">{props.title}</h2>
        <Show when={props.description}>
          <p data-vesta="settings-section-description">{props.description}</p>
        </Show>
      </header>
      <div data-vesta="settings-section-body">{props.children}</div>
    </section>
  );
}

/** One setting: label and help on the left, the control on the right. */
export function SettingRow(props: { label: string; description?: string; children: JSX.Element }) {
  return (
    <div data-vesta="setting-row">
      <div data-vesta="setting-row-copy">
        <span data-vesta="setting-row-label">{props.label}</span>
        <Show when={props.description}>
          <span data-vesta="setting-row-description">{props.description}</span>
        </Show>
      </div>
      <div data-vesta="setting-row-control">{props.children}</div>
    </div>
  );
}
