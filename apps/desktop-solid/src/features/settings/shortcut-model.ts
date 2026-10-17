/** Keep durable IDs and physical key codes compatible with the original launcher. */
export function shortcutCommandId(id: string) {
  if (id === 'reload') return 'app.reload';
  if (id === 'close-page') return 'app.close';
  if (id === 'search') return 'navigation.focus-search';
  if (id.startsWith('pinned-')) return `navigation.pinned.${id.slice(7)}`;
  return `navigation.${id}`;
}
const keyCodes: Record<string, string> = { ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote', '-': 'Minus', '=': 'Equal', ' ': 'Space', '+': 'Equal' };
export function toHostChord(chord: string | null): string | null {
  if (chord === null) return null;
  const parts = chord.split(/\+(?=.)/);
  const key = parts.pop()!;
  parts.push(keyCodes[key] ?? (/^[A-Z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key));
  return parts.join('+');
}
export function fromHostChord(chord: string | null): string | null {
  if (chord === null) return null;
  const parts = chord.split(/\+(?=.)/);
  const key = parts.pop()!;
  parts.push(Object.entries(keyCodes).find(([, code]) => code === key)?.[0] ?? key.replace(/^Key([A-Z])$/, '$1').replace(/^Digit(\d)$/, '$1'));
  return parts.join('+');
}
export interface NativeKeybinding { commandId: string; currentChord: string | null; defaultChord: string | null; available: boolean }
export function shortcutOverrides(commands: NativeKeybinding[], ids: string[]) {
  return Object.fromEntries(ids.flatMap((id) => {
    const command = commands.find((item) => item.commandId === shortcutCommandId(id) && item.available);
    return command ? [[id, fromHostChord(command.currentChord)]] : [];
  }));
}

/** Match physical codes as persisted by the host, independent of keyboard layout. */
export function matchesShortcut(event: KeyboardEvent, chord: string, mac: boolean) {
  const modifiers: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) modifiers.push('Mod');
  if (mac && event.ctrlKey) modifiers.push('Ctrl');
  if (!mac && event.metaKey) modifiers.push('Meta');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  const key = event.code || toHostChord(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return [...modifiers, key].join('+') === toHostChord(chord);
}
