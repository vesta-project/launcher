import { Match, Switch, onCleanup } from 'solid-js';
import { isServer } from '@solidjs/web';
import { findInstance } from '../features/instances/fixtures';
import { AccountLoginDialog } from '../features/accounts/account-login-dialog';
import { useAccountSync } from '../features/accounts/accounts';
import { BrowsePage } from '../pages/browse/browse-page';
import { CreatePage } from '../pages/create/create-page';
import { LibraryPage } from '../pages/library/library-page';
import { SettingsPage } from '../pages/settings/settings-page';
import { usePreferences } from './preferences';
import { Rail } from './rail';
import { route } from './router';
import { Titlebar } from './titlebar';
import { goBack } from './transition';
import './shell.css';

/** Window frame: titlebar across the top, then the rail beside the scene. */
export function Shell() {
  usePreferences();
  useAccountSync();
  useMouseBack();

  return (
    <div data-vesta="shell">
      <Titlebar />
      <AccountLoginDialog />
      <div data-vesta="shell-body">
        <Rail />
        <main data-vesta="scene" id="scene" tabindex={-1}>
          <Switch>
            <Match when={route().page === 'library'}>
              <LibraryPage />
            </Match>
            <Match when={route().page === 'browse'}>
              <BrowsePage />
            </Match>
            <Match when={route().page === 'create'}>
              <CreatePage />
            </Match>
            <Match when={route().page === 'settings'}>
              <SettingsPage />
            </Match>
          </Switch>
        </main>
      </div>
    </div>
  );
}

/** The mouse's back button steps back through launcher history, like a desktop app. */
function useMouseBack() {
  if (isServer) return;
  const onMouseUp = (event: MouseEvent) => {
    if (event.button !== 3) return;
    event.preventDefault();
    const current = route();
    if (current.page === 'library' && !current.section) return;
    goBack('/library', findInstance(current.section)?.instance.id);
  };
  window.addEventListener('mouseup', onMouseUp);
  onCleanup(() => window.removeEventListener('mouseup', onMouseUp));
}
