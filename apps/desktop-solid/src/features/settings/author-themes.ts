import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createSignal, onSettled, untrack } from 'solid-js';
import {
  isCurrentAppearance,
  MAX_THEME_FILE_BYTES,
  type AppearanceSnapshot,
  type AuthorThemePreview,
} from './author-theme-model';

export const authorThemesAvailable = typeof window !== 'undefined' && isTauri();
export const [appearanceSnapshot, setAppearanceSnapshot] = createSignal<AppearanceSnapshot | undefined>(undefined, { name: 'appearanceSnapshot' });
export const [authorThemePreview, setAuthorThemePreview] = createSignal<AuthorThemePreview | undefined>(undefined, { name: 'authorThemePreview' });
export const [authorThemesReady, setAuthorThemesReady] = createSignal(false, { name: 'authorThemesReady' });
export const [authorThemesError, setAuthorThemesError] = createSignal<string | undefined>(undefined, { name: 'authorThemesError' });
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let request = 0;
let previewRequest = 0;

export function acceptAppearance(snapshot: AppearanceSnapshot) {
  setAppearanceSnapshot((current) => isCurrentAppearance(current, snapshot) ? snapshot : current);
}

export async function refreshAuthorThemes(): Promise<AppearanceSnapshot> {
  const started = ++request;
  try {
    const snapshot = await invoke<AppearanceSnapshot>('get_author_theme_state');
    acceptAppearance(snapshot);
    if (started === request) {
      // Hydration is valid even while the native window is waiting to be presented.
      setAuthorThemesReady(true);
      setAuthorThemesError(undefined);
    }
    return untrack(appearanceSnapshot)!;
  } catch (error) {
    if (started === request) {
      // Keep the last canonical theme during transient read failures.
      setAuthorThemesError(String(error));
      clearLocalPreview();
    }
    throw error;
  }
}

function clearLocalPreview() {
  clearTimeout(previewTimer);
  previewTimer = undefined;
  setAuthorThemePreview(undefined);
}

export async function cancelAuthorThemePreview() {
  ++previewRequest;
  const preview = untrack(authorThemePreview);
  clearLocalPreview();
  if (preview) await invoke('cancel_author_theme_preview', { token: preview.token });
}

/** No renderer confirmation flag: Rust owns the native dialog and the commit decision. */
export async function tryAuthorTheme(id: string) {
  await cancelAuthorThemePreview();
  const started = previewRequest;
  const current = await refreshAuthorThemes();
  if (started !== previewRequest) return;
  const preview = await invoke<AuthorThemePreview>('begin_author_theme_preview', {
    id, expectedRevision: current.revision,
  });
  if (started !== previewRequest || document.visibilityState === 'hidden') {
    await invoke('cancel_author_theme_preview', { token: preview.token });
    return;
  }
  setAuthorThemePreview(preview);
  previewTimer = setTimeout(() => {
    if (untrack(authorThemePreview)?.token === preview.token)
      void cancelAuthorThemePreview().catch((error) => setAuthorThemesError(String(error)));
  }, Math.max(0, preview.expiresAt - Date.now()));
  try {
    // Let the WebView paint the preview before opening the native confirmation.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (started !== previewRequest || untrack(authorThemePreview)?.token !== preview.token) return;
    const snapshot = await invoke<AppearanceSnapshot>('confirm_author_theme_preview', { token: preview.token });
    acceptAppearance(snapshot);
  } finally {
    if (untrack(authorThemePreview)?.token === preview.token) clearLocalPreview();
    // Preserve the original native failure; refresh reports its own failure through the error signal.
    await refreshAuthorThemes().catch(() => {});
  }
}

async function mutate(command: string, args: Record<string, unknown> = {}) {
  const current = await refreshAuthorThemes();
  try {
    const snapshot = await invoke<AppearanceSnapshot>(command, { ...args, expectedRevision: current.revision });
    acceptAppearance(snapshot);
    return snapshot;
  } catch (error) {
    await refreshAuthorThemes().catch(() => {});
    throw error;
  }
}

export async function importAuthorTheme(file: File) {
  if (file.size > MAX_THEME_FILE_BYTES) throw new Error('Theme files must be no larger than 256 KiB.');
  const contents = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  return mutate('import_author_theme', { contents });
}
export const removeAuthorTheme = (id: string) => mutate('remove_author_theme', { id });
export const disableAuthorTheme = () => mutate('disable_author_theme');
export const persistBuiltInTheme = (updates: Record<string, unknown>) => mutate('update_rewrite_theme', { updates });

/** Subscribe before loading. Never mirror author CSS into localStorage. */
export function useAuthorThemeSync() {
  if (!authorThemesAvailable) return;
  onSettled(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const refresh = () => {
      if (!disposed)
        void refreshAuthorThemes().catch(() => {});
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        void cancelAuthorThemePreview().catch(() => {});
      } else refresh();
    };
    const leaving = () => void cancelAuthorThemePreview().catch(() => {});
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', refresh);
    window.addEventListener('pagehide', leaving);
    void Promise.all([
      listen('rewrite-theme-updated', refresh),
      listen<{ token: string }>('author-theme-preview-ended', (event) => {
        if (untrack(authorThemePreview)?.token === event.payload.token) {
          clearLocalPreview();
          refresh();
        }
      }),
    ]).then((listeners) => {
      if (disposed) for (const stop of listeners) stop();
      else { stops.push(...listeners); refresh(); }
    }).catch((error) => {
      setAuthorThemesError(String(error));
      refresh();
    });
    return () => {
      disposed = true;
      ++request;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pagehide', leaving);
      for (const stop of stops) stop();
      leaving();
    };
  });
}
