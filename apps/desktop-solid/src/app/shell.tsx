import { useWindowEffects } from '../features/settings/window-effects';
import { useThemeRuntime } from '../features/settings/theme-runtime';
import { Match, Switch, Show, onCleanup } from 'solid-js';
import { isServer } from '@solidjs/web';
import { findInstance } from '../features/instances/catalog';
import { AccountLoginDialog } from '../features/accounts/account-login-dialog';
import { ExternalLinkDialog } from '../features/links/external-link-dialog';
import { LinkPreview } from '../features/links/link-preview';
import { Button, TooltipHints } from '@vesta/ui';
import { t } from '../localization';
import { instanceError, clearInstanceError, refreshNativeInstances, useInstanceSync } from '../features/instances/native-service';
import { useAccountSync } from '../features/accounts/accounts';
import { useConfigSync } from '../features/settings/config';
import { prefetchSettingsWhenIdle, useSettingsResourceSync } from '../features/settings/resources';
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
import '../styles/reduced-motion.css';
import { useReducedMotion } from '../features/settings/reduced-motion';
import { useShortcutRuntime } from '../features/settings/shortcut-runtime';

/** Window frame: titlebar across the top, then the rail beside the scene. */
export function Shell() {
  usePreferences();
  useThemeRuntime();
  useWindowEffects();
  useAccountSync();
  useConfigSync();
  useReducedMotion();
  useShortcutRuntime();
  useSettingsResourceSync();
  prefetchSettingsWhenIdle();
  useInstanceSync();
  useMouseBack();

  return (
    <div data-vesta="shell">
      <Titlebar />
      <AccountLoginDialog />
      <TooltipHints />
      <LinkPreview />
      <ExternalLinkDialog />
      <Show when={instanceError()}><div data-vesta="instance-service-error" role="alert">
        <span>{instanceError()}</span>
        <Button size="sm" variant="ghost" onClick={()=>{clearInstanceError();void refreshNativeInstances(true);}}>{t('common.retry')}</Button>
        <Button size="sm" variant="ghost" onClick={clearInstanceError}>{t('nav.close')}</Button>
      </div></Show>
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
