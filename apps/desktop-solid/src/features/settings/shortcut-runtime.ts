import { isTauri } from '@tauri-apps/api/core';
import { onSettled } from 'solid-js';
import { detectPlatform } from '../../app/platform';
import { navigate } from '../../app/router';
import { pinnedInstances } from '../instances/catalog';
import { shortcuts, shortcutCatalog, useShortcutSync } from './shortcuts';
import { matchesShortcut, ownsDeletionKey, isTextEditingTarget } from './shortcut-model';

export function useShortcutRuntime() {
  useShortcutSync();
  if (typeof window === 'undefined') return;
  onSettled(() => {
    const platform = detectPlatform();
    const mac = platform === 'macos' || (platform === 'web' && /Mac|iPhone|iPad/.test(navigator.platform));
    // Capture is essential: portalled widgets can stop bubbling without cancelling defaults.
    const deletion = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      ownsDeletionKey(event, isTextEditingTarget(target));
    };
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Recording owns its keystrokes, even before its local handler runs.
      if (target?.closest('[data-recording]')) return;
      const editable = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if (ownsDeletionKey(event, !!editable)) return;
      if (isTauri() && !shortcutCatalog.ready()) return;
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const command = shortcuts().find((item) => item.chord && matchesShortcut(event, item.chord, mac));
      if (!command) return;
      if (editable && !command.chord?.split('+').includes('Mod')) return;
      let action: (() => void) | undefined;
      const paths: Record<string, string> = { library: '/library', 'new-instance': '/create', explore: '/browse', settings: '/settings', 'close-page': '/library', notifications: '/settings/notifications' };
      if (command.id in paths) action = () => navigate(paths[command.id]);
      else if (command.id === 'reload') action = () => location.reload();
      else if (command.id === 'back') action = () => history.back();
      else if (command.id === 'forward') action = () => history.forward();
      else if (command.id === 'search') {
        const input = document.querySelector<HTMLInputElement>('main input[type="search"]:not([disabled]), main [data-vesta="field"] input:not([disabled])');
        if (input) action = () => input.focus();
      } else if (command.id.startsWith('pinned-')) {
        const pins = pinnedInstances();
        const entry = command.id === 'pinned-last' ? pins.at(-1) : pins[Number(command.id.slice(7)) - 1];
        if (entry) action = () => navigate(`/library/${entry.instance.id}`);
      }
      if (action) { event.preventDefault(); action(); }
    };
    window.addEventListener('keydown', deletion, { capture: true });
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', deletion, { capture: true });
      window.removeEventListener('keydown', keydown);
    };
  });
}
