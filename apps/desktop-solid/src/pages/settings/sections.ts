import type { MessageId } from '../../localization/messages';

export const sections = [
  'general',
  'appearance',
  'notifications',
  'shortcuts',
  'defaults',
  'java',
  'sandbox',
  'downloads',
  'storage',
  'sync',
  'account',
  'about',
  'developer',
] as const;
export type SectionId = (typeof sections)[number];

export const isSection = (value: string | undefined): value is SectionId => sections.includes(value as SectionId);

export const sectionLabels: Record<SectionId, MessageId> = {
  general: 'prefs.general.title',
  appearance: 'prefs.appearance.title',
  notifications: 'prefs.notifications.title',
  shortcuts: 'prefs.shortcuts.title',
  defaults: 'prefs.defaults.title',
  java: 'prefs.java.title',
  sandbox: 'prefs.sandbox.title',
  downloads: 'prefs.downloads.title',
  storage: 'prefs.storage.title',
  sync: 'prefs.sync.title',
  account: 'prefs.account.title',
  about: 'prefs.about.title',
  developer: 'prefs.developer.title',
};

export const sectionDescriptions: Record<SectionId, MessageId> = {
  general: 'prefs.general.description',
  appearance: 'prefs.appearance.description',
  notifications: 'prefs.notifications.description',
  shortcuts: 'prefs.shortcuts.description',
  defaults: 'prefs.defaults.description',
  java: 'prefs.java.description',
  sandbox: 'prefs.sandbox.description',
  downloads: 'prefs.downloads.description',
  storage: 'prefs.storage.description',
  sync: 'prefs.sync.description',
  account: 'prefs.account.description',
  about: 'prefs.about.description',
  developer: 'prefs.developer.description',
};

export const sectionIcons: Record<SectionId, string> = {
  general: 'icons/content/sliders',
  appearance: 'icons/content/layers',
  notifications: 'icons/status/bell',
  shortcuts: 'icons/content/keyboard',
  defaults: 'icons/content/monitor',
  java: 'icons/content/code',
  sandbox: 'icons/security/shield',
  downloads: 'icons/actions/download',
  storage: 'icons/content/storage',
  sync: 'icons/content/link',
  account: 'icons/content/skin-icon',
  about: 'icons/status/info',
  developer: 'icons/content/terminal',
};

/** Navigation groups, in the order they appear. Account sits first: it is about you, not the app. */
export const sectionGroups: { label: MessageId; items: SectionId[] }[] = [
  { label: 'prefs.group.you', items: ['account'] },
  {
    label: 'prefs.group.launcher',
    items: ['general', 'appearance', 'notifications', 'shortcuts'],
  },
  { label: 'prefs.group.games', items: ['defaults', 'java', 'sandbox'] },
  { label: 'prefs.group.data', items: ['downloads', 'storage', 'sync'] },
  { label: 'prefs.group.about', items: ['about', 'developer'] },
];

/**
 * Every individual setting, so the search box can take you to the page that holds it.
 * Keep the labels in step with the pages: the search matches the translated text.
 */
export const settingIndex: { section: SectionId; label: MessageId }[] = [
  { section: 'general', label: 'prefs.general.language' },
  { section: 'general', label: 'prefs.general.reduced-motion' },
  { section: 'general', label: 'prefs.general.autostart' },
  { section: 'general', label: 'prefs.general.tray' },
  { section: 'general', label: 'prefs.general.close-to-tray' },
  { section: 'general', label: 'prefs.general.gpu' },
  { section: 'general', label: 'prefs.general.telemetry' },
  { section: 'general', label: 'prefs.general.discord' },
  { section: 'general', label: 'prefs.general.trusted-sites' },
  { section: 'appearance', label: 'prefs.appearance.theme' },
  { section: 'appearance', label: 'prefs.appearance.color-mode' },
  { section: 'appearance', label: 'prefs.appearance.hue' },
  { section: 'appearance', label: 'prefs.appearance.window-effect' },
  { section: 'appearance', label: 'prefs.appearance.style' },
  { section: 'appearance', label: 'prefs.appearance.translucency' },
  { section: 'appearance', label: 'prefs.appearance.grain' },
  { section: 'appearance', label: 'prefs.appearance.gradient' },
  { section: 'appearance', label: 'prefs.appearance.harmony' },
  { section: 'appearance', label: 'prefs.appearance.border' },
  { section: 'notifications', label: 'prefs.notifications.enabled' },
  { section: 'notifications', label: 'prefs.notifications.sources' },
  { section: 'notifications', label: 'prefs.notifications.add-feed' },
  { section: 'shortcuts', label: 'prefs.shortcuts.title' },
  { section: 'defaults', label: 'prefs.defaults.window' },
  { section: 'defaults', label: 'prefs.defaults.memory' },
  { section: 'defaults', label: 'prefs.defaults.after-launch' },
  { section: 'defaults', label: 'prefs.defaults.java-args' },
  { section: 'defaults', label: 'prefs.defaults.environment' },
  { section: 'java', label: 'prefs.java.environments' },
  { section: 'sandbox', label: 'prefs.sandbox.pre-launch' },
  { section: 'sandbox', label: 'prefs.sandbox.wrapper' },
  { section: 'sandbox', label: 'prefs.sandbox.post-exit' },
  { section: 'sandbox', label: 'prefs.sandbox.preset' },
  { section: 'sandbox', label: 'prefs.sandbox.nesting' },
  { section: 'sandbox', label: 'prefs.sandbox.folders' },
  { section: 'downloads', label: 'prefs.downloads.threads' },
  { section: 'downloads', label: 'prefs.downloads.cache-limit' },
  { section: 'downloads', label: 'prefs.downloads.auto-dependencies' },
  { section: 'downloads', label: 'prefs.downloads.manual-dependencies' },
  { section: 'downloads', label: 'prefs.downloads.proxy' },
  { section: 'downloads', label: 'prefs.downloads.proxy-url' },
  { section: 'storage', label: 'prefs.storage.usage' },
  { section: 'storage', label: 'prefs.storage.clear-cache' },
  { section: 'sync', label: 'prefs.sync.options' },
  { section: 'sync', label: 'prefs.sync.keybinds' },
  { section: 'sync', label: 'prefs.sync.servers' },
  { section: 'account', label: 'prefs.account.accounts' },
  { section: 'about', label: 'prefs.about.auto-update' },
  { section: 'about', label: 'prefs.about.startup-check' },
  { section: 'about', label: 'prefs.about.changelog' },
  { section: 'about', label: 'prefs.about.reset' },
  { section: 'developer', label: 'prefs.developer.debug-logging' },
];
