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
export const [hue, setHue] = createSignal(initial.hue, { name: 'hue' });
export const [railCollapsed, setRailCollapsed] = createSignal(initial.railCollapsed, { name: 'railCollapsed' });

/**
 * Applies preferences to the document root. The scheme and accent live on <html>,
 * not the shell, so portalled overlays (menus, dialogs, tooltips) inherit them too.
 * Call once from the shell.
 */
export function usePreferences() {
  if (!hasWindow) return; // static prerender: nothing to apply yet
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const [systemLight, setSystemLight] = createSignal(media.matches, { name: 'systemLight' });
  const onChange = (event: MediaQueryListEvent) => setSystemLight(event.matches);
  media.addEventListener('change', onChange);
  onCleanup(() => media.removeEventListener('change', onChange));

  createEffect(
    () => (scheme() === 'system' ? (systemLight() ? 'light' : 'dark') : scheme()),
    (resolved) => {
      document.documentElement.dataset.vestaScheme = resolved;
    },
  );

  createEffect(hue, (value) => {
    document.documentElement.style.setProperty('--vesta-accent-hue', String(value));
  });

  // Appearance is persisted by the coalesced theme store, never once per drag frame.
  createEffect(railCollapsed, (collapsed) => {
    try { localStorage.setItem(KEY, JSON.stringify({ railCollapsed: collapsed })); }
    catch { /* Navigation still works when browser storage is unavailable. */ }
  });
}
