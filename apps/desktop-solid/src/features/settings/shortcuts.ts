import { createSignal, onSettled } from 'solid-js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { cachedResource } from './cached-resource';
import { shortcutCommandId, shortcutOverrides, toHostChord, fromHostChord, type NativeKeybinding } from './shortcut-model';
import type { Platform } from '../../app/platform';
import type { MessageId } from '../../localization/messages';

export interface Shortcut {
  id: string;
  group: 'application' | 'navigation';
  label: MessageId;
  description?: MessageId;
  /** `Mod+Shift+K` style. `Mod` is ⌘ on macOS and Ctrl elsewhere. */
  chord: string | null;
  defaultChord: string | null;
}

export const shortcutGroups: { id: Shortcut['group']; label: MessageId }[] = [
  { id: 'application', label: 'prefs.shortcuts.group-application' },
  { id: 'navigation', label: 'prefs.shortcuts.group-navigation' },
];

const defaults: Omit<Shortcut, 'chord'>[] = [
  {
    id: 'reload',
    group: 'application',
    label: 'prefs.shortcuts.reload',
    defaultChord: 'Mod+R',
  },
  {
    id: 'close-page',
    group: 'application',
    label: 'prefs.shortcuts.close-page',
    defaultChord: 'Mod+W',
  },
  {
    id: 'back',
    group: 'navigation',
    label: 'prefs.shortcuts.back',
    defaultChord: 'Alt+ArrowLeft',
  },
  {
    id: 'forward',
    group: 'navigation',
    label: 'prefs.shortcuts.forward',
    defaultChord: 'Alt+ArrowRight',
  },
  {
    id: 'library',
    group: 'navigation',
    label: 'prefs.shortcuts.library',
    defaultChord: 'Mod+1',
  },
  {
    id: 'new-instance',
    group: 'navigation',
    label: 'prefs.shortcuts.new-instance',
    defaultChord: 'Mod+2',
  },
  {
    id: 'explore',
    group: 'navigation',
    label: 'prefs.shortcuts.explore',
    defaultChord: 'Mod+3',
  },
  {
    id: 'pinned-1',
    group: 'navigation',
    label: 'prefs.shortcuts.pinned-1',
    defaultChord: 'Mod+4',
  },
  {
    id: 'pinned-2',
    group: 'navigation',
    label: 'prefs.shortcuts.pinned-2',
    defaultChord: 'Mod+5',
  },
  {
    id: 'pinned-3',
    group: 'navigation',
    label: 'prefs.shortcuts.pinned-3',
    defaultChord: 'Mod+6',
  },
  {
    id: 'pinned-4',
    group: 'navigation',
    label: 'prefs.shortcuts.pinned-4',
    defaultChord: 'Mod+7',
  },
  {
    id: 'pinned-5',
    group: 'navigation',
    label: 'prefs.shortcuts.pinned-5',
    defaultChord: 'Mod+8',
  },
  {
    id: 'pinned-last',
    group: 'navigation',
    label: 'prefs.shortcuts.pinned-last',
    defaultChord: 'Mod+9',
  },
  {
    id: 'settings',
    group: 'navigation',
    label: 'prefs.shortcuts.settings',
    defaultChord: 'Mod+,',
  },
  {
    id: 'notifications',
    group: 'navigation',
    label: 'prefs.shortcuts.notifications',
    defaultChord: null,
  },
  {
    id: 'search',
    group: 'navigation',
    label: 'prefs.shortcuts.search',
    defaultChord: 'Mod+F',
  },
];

const native = typeof window !== "undefined" && isTauri();
const KEY = 'vesta:shortcuts';
function saved(): Record<string, string | null> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

const [store, setStore] = createSignal<Record<string, string | null>>(saved(), {
  name: 'shortcutOverrides',
});

const ids = defaults.map((item) => item.id);
let reconciled = false;
export const shortcutCatalog = cachedResource<NativeKeybinding[]>({
  key: 'shortcut-catalog', fallback: [],
  load: async () => {
    if (!native) return [];
    if (reconciled) return invoke<NativeKeybinding[]>('list_keybinding_commands');
    const result = await invoke<NativeKeybinding[]>('reconcile_keybinding_catalog', {
      definitions: defaults.map((item, sortOrder) => ({
        commandId: shortcutCommandId(item.id), handlerId: shortcutCommandId(item.id),
        label: item.label, description: item.description ?? item.label, category: item.group,
        defaultChord: toHostChord(item.defaultChord), sortOrder,
      })),
    });
    reconciled = true;
    return result;
  },
});
/** Reads share the cached host catalog; browser overrides remain local. */
export const shortcuts = (): Shortcut[] => {
  const overrides = native ? shortcutOverrides(shortcutCatalog.data(), ids) : store();
  return defaults.map((item) => ({ ...item, chord: item.id in overrides ? overrides[item.id] : item.defaultChord }));
};
const [error, setError] = createSignal('', { name: 'shortcutSaveError' });
export const shortcutError = () => error() || (shortcutCatalog.error() ? String(shortcutCatalog.error()) : "");
let writes = Promise.resolve();
function mutate(command: string, id: string, extra: Record<string, unknown> = {}) {
  writes = writes.then(async () => {
    setError('');
    try {
      if (!reconciled) await shortcutCatalog.refresh();
      if (!reconciled) throw new Error('The shortcut catalog could not be loaded.');
      const result = await invoke<{ applied: boolean; conflict?: NativeKeybinding }>(command, { commandId: shortcutCommandId(id), ...extra });
      if (!result.applied) throw new Error(`Shortcut conflicts with ${result.conflict?.commandId ?? 'another command'}`);
      await shortcutCatalog.refresh(true);
    } catch (reason) { setError(String(reason)); }
  });
  return writes;
}
function saveLocal(update: (current: Record<string, string | null>) => Record<string, string | null>) {
  setStore((current) => {
    const next = update(current);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Session-only fallback. */ }
    return next;
  });
}
export function setShortcut(id: string, chord: string | null, replaceConflict = false) {
  if (native) return chord === null ? mutate('clear_keybinding', id)
    : mutate('set_keybinding', id, { chord: toHostChord(chord), replaceConflict });
  const conflict = replaceConflict && chord ? shortcuts().find((item) => item.id !== id && item.chord === chord) : undefined;
  saveLocal((current) => ({ ...current, ...(conflict ? { [conflict.id]: null } : {}), [id]: chord }));
}
export function resetShortcut(id: string) {
  if (native) return mutate('reset_keybinding', id, { replaceConflict: false });
  saveLocal((current) => { const { [id]: _removed, ...rest } = current; return rest; });
}
export function useShortcutSync() {
  if (!native) return;
  onSettled(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen('core://keybindings-updated', () => void shortcutCatalog.refresh(true)).then((unlisten) => {
      if (disposed) unlisten(); else stop = unlisten;
      if (!disposed) void shortcutCatalog.refresh();
    }).catch((reason) => { setError(String(reason)); void shortcutCatalog.refresh(); });
    return () => { disposed = true; stop?.(); };
  });
}

const modifierKeys = new Set(['Meta', 'Control', 'Alt', 'Shift']);

/** Turns a key press into a chord, or undefined while only modifiers are held. */
export function chordFromEvent(event: KeyboardEvent, platform: Platform): string | undefined {
  if (modifierKeys.has(event.key)) return undefined;
  const mac = platform === 'macos' || (platform === 'web' && typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform));
  const parts: string[] = [];
  const mod = mac ? event.metaKey : event.ctrlKey;
  if (mod) parts.push('Mod');
  if (mac && event.ctrlKey) parts.push('Ctrl');
  if (!mac && event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(event.code ? fromHostChord(event.code)! : event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join('+');
}

const symbols: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
};

/** Keycap labels for a chord on this platform. */
export function chordKeys(chord: string, platform: Platform): string[] {
  const mac = platform === 'macos' || (platform === 'web' && typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform));
  return chord.split(/\+(?=.)/).map((part) => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'Alt') return mac ? '⌥' : 'Alt';
    if (part === 'Shift') return mac ? '⇧' : 'Shift';
    if (part === 'Ctrl') return mac ? '⌃' : 'Ctrl';
    if (part === 'Meta') return 'Win';
    return symbols[part] ?? part;
  });
}
