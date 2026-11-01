// The few pieces every server settings section is built from, so General, Game, Sleep &
// status, Players and Access read as one page type: titled panels, collapsible groups, a
// search field and the floating save bar.
import { Button, IconButton, TextField, toast } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import type { SettingsSectionId } from '../../features/servers/shell-model';
import { useServerShell } from './shell-context';
import './server-settings.css';
import { Card } from '../settings/parts';

/**
 * One section's page: a scrolling column of panels, with room reserved at the bottom for
 * the save bar so it never moves the content when it appears.
 */
export function SettingsPage(props: { children: JSX.Element; saveBar?: JSX.Element; class?: string }) {
  return (
    <div data-vesta="settings-content" data-server-settings-page class={props.class}>
      <div data-vesta="instance-settings-scroll">{props.children}</div>
      {props.saveBar}
    </div>
  );
}

/**
 * A section's controls with its secondary panels (previews, lists, reference facts) beside
 * them once the pane is wide; narrower panes keep one column in the order given, the aside
 * after the controls or, with `asideFirst`, before them.
 */
export function SettingsColumns(props: { aside?: JSX.Element; asideFirst?: boolean; children: JSX.Element }) {
  return (
    <div data-vesta="settings-columns" data-aside-first={props.asideFirst ? '' : undefined}>
      <div data-vesta="settings-columns-main">{props.children}</div>
      <div data-vesta="settings-columns-aside">{props.aside}</div>
    </div>
  );
}

/** Launcher settings card with the server panel marker retained. */
export function SettingsPanel(props: {
  title: string;
  description?: JSX.Element;
  action?: JSX.Element;
  danger?: boolean;
  children?: JSX.Element;
  /** Marks the panel for tests and screenshots. */
  name?: string;
}) {
  return (
    <div data-server-panel={props.name}>
      <Card title={props.title} description={props.description} action={props.action} danger={props.danger}>{props.children}</Card>
    </div>
  );
}

/** A panel whose rows stay folded away until opened; the header summarises what's inside. */
export function SettingsGroup(props: {
  title: string;
  summary?: JSX.Element;
  open: boolean;
  onToggle: () => void;
  children: JSX.Element;
}) {
  return (
    <section data-vesta="prefs-card" data-server-group data-open={props.open ? '' : undefined}>
      <button type="button" data-vesta="server-group-toggle" aria-expanded={props.open ? 'true' : 'false'} onClick={() => props.onToggle()}>
        <Icon name="icons/controls/chevron-right" size={14} />
        <h3>{props.title}</h3>
        <span data-vesta="server-group-summary">{props.summary}</span>
      </button>
      <Show when={props.open}>
        <div data-vesta="settings-panel-body">{props.children}</div>
      </Show>
    </section>
  );
}

/** The search field at the top of a section, with a search icon and a clear button. */
export function SettingsSearch(props: { value: string; onChange: (value: string) => void; placeholder: string; size?: 'sm' | 'md' }) {
  return (
    <div data-vesta="server-settings-search">
      <TextField
        size={props.size ?? 'md'}
        aria-label={props.placeholder}
        placeholder={props.placeholder}
        icon={<Icon name="icons/content/search" size={14} />}
        value={props.value}
        onChange={props.onChange}
        onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape' && props.value) { event.stopPropagation(); props.onChange(''); } }}
      />
      <Show when={props.value}>
        <IconButton size="sm" variant="ghost" label={t('prefs.clear-search')} icon={<Icon name="icons/actions/close" />} onClick={() => props.onChange('')} />
      </Show>
    </div>
  );
}

/** Floats at the bottom of the page while there are unsaved changes. */
export function SaveBar(props: {
  show: boolean;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Show when={props.show}>
      <div data-vesta="settings-savebar" role="region" aria-label={props.label}>
        <span data-vesta="settings-savebar-dot" />
        <span>{props.label}</span>
        <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onDiscard()}>{t('server-files.discard')}</Button>
        <Button size="sm" tone="accent" disabled={props.busy || props.disabled} onClick={() => props.onSave()}>{t('server-files.save')}</Button>
      </div>
    </Show>
  );
}

/** A link-styled button to another settings section, e.g. "Change in Game". */
export function SectionLink(props: { section: SettingsSectionId; children: JSX.Element }) {
  const shell = useServerShell();
  return (
    <Show when={shell?.openSection}>
      <Button size="sm" variant="ghost" onClick={() => shell?.openSection?.(props.section)}>{props.children}</Button>
    </Show>
  );
}

/** Copies text and confirms with a toast. */
export function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
  toast.show({ title: t('servers.copied'), tone: 'neutral' });
}

/** Monospace value with a copy button, e.g. a command or a UUID. */
export function CopyValue(props: { value: string; label: string; children?: JSX.Element }) {
  return (
    <span data-vesta="server-copy-value">
      <code>{props.children ?? props.value}</code>
      <IconButton size="sm" variant="ghost" label={props.label} icon={<Icon name="icons/actions/copy" />} onClick={() => copyText(props.value)} />
    </span>
  );
}
