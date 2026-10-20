import { createEffect, createSignal, onCleanup } from 'solid-js';

export type SchemePreference = 'system' | 'light' | 'dark';

const KEY = 'vesta:preferences';
const hasWindow = typeof window !== 'undefined';

interface Stored {
  scheme: SchemePreference;
  hue: number;
  railCollapsed: boolean;
}

const defaults: Stored = { scheme: 'system', hue: 185, railCollapsed: false };

function load(): Stored {
  if (!hasWindow) return defaults;
  try {
    return { ...defaults, railCollapsed: JSON.parse(localStorage.getItem(KEY) ?? '{}').railCollapsed === true };
  } catch {
    return defaults;
  }
}

const initial = load();
export const [scheme, setScheme] = createSignal<SchemePreference>(initial.scheme, { name: 'scheme' });
export const [themeSchemeOverride, setThemeSchemeOverride] = createSignal<SchemePreference | undefined>(undefined, { name: 'themeSchemeOverride' });
export const [railCollapsed, setRailCollapsed] = createSignal(initial.railCollapsed, { name: 'railCollapsed' });

const media = hasWindow ? window.matchMedia('(prefers-color-scheme: light)') : undefined;
const [systemLight, setSystemLight] = createSignal(media?.matches ?? false, { name: 'systemLight' });

/** The colour scheme in effect: the preference, with 'system' resolved against the OS. */
export const resolvedScheme = (): 'light' | 'dark' => {
  const preference = themeSchemeOverride() ?? scheme();
  return preference === 'system' ? (systemLight() ? 'light' : 'dark') : preference === 'light' ? 'light' : 'dark';
};

/**
 * Applies preferences to the document root. The scheme and accent live on <html>,
 * not the shell, so portalled overlays (menus, dialogs, tooltips) inherit them too.
 * Call once from the shell.
 */
export function usePreferences() {
  if (!hasWindow || !media) return; // static prerender: nothing to apply yet
  const onChange = (event: MediaQueryListEvent) => setSystemLight(event.matches);
  media.addEventListener('change', onChange);
  onCleanup(() => media.removeEventListener('change', onChange));

  createEffect(
    resolvedScheme,
    (resolved) => {
      document.documentElement.dataset.vestaScheme = resolved;
    },
  );

  // Appearance is persisted by the coalesced theme store, never once per drag frame.
  createEffect(railCollapsed, (collapsed) => {
    try { localStorage.setItem(KEY, JSON.stringify({ railCollapsed: collapsed })); }
    catch { /* Navigation still works when browser storage is unavailable. */ }
  });
}
