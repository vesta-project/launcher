import { Match, Switch } from 'solid-js';
import { useAccountSync } from '../features/accounts/accounts';
import { BrowsePage } from '../pages/browse/browse-page';
import { CreatePage } from '../pages/create/create-page';
import { LibraryPage } from '../pages/library/library-page';
import { SettingsPage } from '../pages/settings/settings-page';
import { usePreferences } from './preferences';
import { Rail } from './rail';
import { route } from './router';
import { Titlebar } from './titlebar';
import './shell.css';

/** Window frame: titlebar across the top, then the rail beside the scene. */
export function Shell() {
  usePreferences();
  useAccountSync();

  return (
    <div data-vesta="shell">
      <Titlebar />
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
