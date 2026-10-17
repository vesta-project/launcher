import { IconButton, Select, TextField } from '@vesta/ui';
import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { navigate, route } from '../../app/router';
import { Board } from '../../components/board';
import { Icon } from '../../components/icon';
import { setting } from '../../features/settings/config';
import { t } from '../../localization';
import { AboutSettings } from './sections/about';
import { AccountSettings } from './sections/account';
import { AppearanceSettings } from './sections/appearance';
import { DefaultsSettings } from './sections/defaults';
import { DeveloperSettings } from './sections/developer';
import { DownloadsSettings } from './sections/downloads';
import { GeneralSettings } from './sections/general';
import { JavaSettings } from './sections/java';
import { NotificationsSettings } from './sections/notifications';
import { SandboxSettings } from './sections/sandbox';
import { ShortcutsSettings } from './sections/shortcuts';
import { StorageSettings } from './sections/storage';
import { SyncSettings } from './sections/sync';
import {
  isSection,
  sectionDescriptions,
  sectionGroups,
  sectionIcons,
  sectionLabels,
  sections,
  settingIndex,
  type SectionId,
} from './sections';
import './settings-page.css';

/** Wraps the matched part of a title in <mark>. */
function highlight(text: string, query: string) {
  const needle = query.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

/** Arrow keys move between result rows. */
function moveFocus(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const rows = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button'));
  const next = rows.indexOf(document.activeElement as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1);
  event.preventDefault();
  rows[Math.min(Math.max(next, 0), rows.length - 1)]?.focus();
}

/**
 * Launcher settings: a grouped section list on the left (with search), one page of cards on
 * the right. Pages render straight from cached state, so nothing here ever waits on the host.
 */
export function SettingsPage() {
  const [query, setQuery] = createSignal('', { name: 'settingsSearch' });
  const active = (): SectionId => {
    const section = route().section;
    if (section === 'developer' && !developer()) return 'general';
    return isSection(section) ? section : 'account';
  };
  const developer = () => setting('developer_mode');
  const visible = (id: SectionId) => id !== 'developer' || developer();
  const groups = createMemo(() =>
    sectionGroups
      .map((group) => ({ ...group, items: group.items.filter(visible) }))
      .filter((group) => group.items.length),
  );
  const open = (section: SectionId) => {
    setQuery('');
    navigate(`/settings/${section}`);
  };

  const results = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return [];
    const pages = sections
      .filter((section) => visible(section) && t(sectionLabels[section]).toLowerCase().includes(needle))
      .map((section) => ({ section, text: t(sectionLabels[section]), page: true }));
    const seen = new Set(pages.map((entry) => `${entry.section}:${entry.text.toLowerCase()}`));
    const found = settingIndex
      .filter((entry) => visible(entry.section))
      .map((entry) => ({ section: entry.section, text: t(entry.label), page: false }))
      .filter((entry) => {
        const key = `${entry.section}:${entry.text.toLowerCase()}`;
        if (!entry.text.toLowerCase().includes(needle) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return [...pages, ...found].slice(0, 30);
  });

  return (
    <Board fixed>
      <div data-vesta="prefs">
        <nav data-vesta="prefs-nav" aria-label={t('prefs.nav-aria')}>
          <TextField
            size="sm"
            class="prefs-search"
            aria-label={t('prefs.search')}
            placeholder={t('prefs.search')}
            value={query()}
            onChange={setQuery}
          />
          <div data-vesta="prefs-nav-scroll">
            <For each={groups()}>
              {(group) => (
                <div data-vesta="prefs-nav-group" role="group" aria-label={t(group.label)}>
                  <span data-vesta="prefs-nav-heading">{t(group.label)}</span>
                  <For each={group.items}>
                    {(section) => (
                      <button
                        type="button"
                        data-vesta="prefs-nav-item"
                        aria-current={!query() && active() === section ? 'page' : undefined}
                        onClick={() => open(section)}
                      >
                        <Icon name={sectionIcons[section]} size={16} />
                        {t(sectionLabels[section])}
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </nav>

        <div data-vesta="prefs-narrow-nav">
          <Select
            size="sm"
            aria-label={t('prefs.nav-aria')}
            value={active()}
            onChange={(value) => open(value as SectionId)}
            options={sections.filter(visible).map((section) => ({
              value: section,
              label: t(sectionLabels[section]),
            }))}
          />
        </div>

        <main data-vesta="prefs-scroll">
          <Show
            when={!query().trim()}
            fallback={
              <div data-vesta="prefs-page">
                <header data-vesta="prefs-page-header">
                  <h2>{t('prefs.search-results', { count: results().length })}</h2>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={t('prefs.clear-search')}
                    icon={<Icon name="icons/actions/close" />}
                    onClick={() => setQuery('')}
                  />
                </header>
                <Show when={results().length} fallback={<p data-vesta="prefs-empty">{t('prefs.no-results')}</p>}>
                  <ul data-vesta="prefs-results" onKeyDown={moveFocus}>
                    <For each={results()}>
                      {(result) => (
                        <li>
                          <button type="button" data-vesta="prefs-result" onClick={() => open(result.section)}>
                            <Icon name={sectionIcons[result.section]} size={16} />
                            <span data-vesta="prefs-result-title">{highlight(result.text, query())}</span>
                            <Show when={!result.page}>
                              <small>{t(sectionLabels[result.section])}</small>
                            </Show>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            }
          >
            <div data-vesta="prefs-page" data-section={active()}>
              <header data-vesta="prefs-page-header">
                <span data-vesta="prefs-page-icon">
                  <Icon name={sectionIcons[active()]} size={18} />
                </span>
                <div>
                  <h2>{t(sectionLabels[active()])}</h2>
                  <p>{t(sectionDescriptions[active()])}</p>
                </div>
              </header>
              <Switch>
                <Match when={active() === 'account'}>
                  <AccountSettings />
                </Match>
                <Match when={active() === 'general'}>
                  <GeneralSettings />
                </Match>
                <Match when={active() === 'appearance'}>
                  <AppearanceSettings />
                </Match>
                <Match when={active() === 'notifications'}>
                  <NotificationsSettings />
                </Match>
                <Match when={active() === 'shortcuts'}>
                  <ShortcutsSettings />
                </Match>
                <Match when={active() === 'defaults'}>
                  <DefaultsSettings />
                </Match>
                <Match when={active() === 'java'}>
                  <JavaSettings />
                </Match>
                <Match when={active() === 'sandbox'}>
                  <SandboxSettings />
                </Match>
                <Match when={active() === 'downloads'}>
                  <DownloadsSettings />
                </Match>
                <Match when={active() === 'storage'}>
                  <StorageSettings />
                </Match>
                <Match when={active() === 'sync'}>
                  <SyncSettings />
                </Match>
                <Match when={active() === 'about'}>
                  <AboutSettings />
                </Match>
                <Match when={active() === 'developer'}>
                  <DeveloperSettings />
                </Match>
              </Switch>
            </div>
          </Show>
        </main>
      </div>
    </Board>
  );
}
