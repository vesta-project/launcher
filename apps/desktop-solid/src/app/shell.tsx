import { useNavigationPreloading } from "./navigation-preload";
import { NativeImportDialog } from '../features/instances/native-import-dialog';
import { InstanceDeleteDialog } from '../features/instances/delete-dialog';
import { useNativeDropZone } from '../features/file-drop/zone';
import { DropTargetDialog, reviewUntargetedDrop } from '../features/file-drop/drop-target-dialog';
import { startNativeFileDrop } from '../features/file-drop/native-bridge';
import { onSettled } from 'solid-js';
import { Match, Switch, Show, onCleanup } from 'solid-js';
import { isServer } from '@solidjs/web';
import { findInstance } from '../features/instances/catalog';
import { AccountLoginDialog } from '../features/accounts/account-login-dialog';
import { ExternalLinkDialog } from '../features/links/external-link-dialog';
import { LinkPreview } from '../features/links/link-preview';
import { Button, TooltipHints, ToastRegion } from '@vesta/ui';
import { t } from '../localization';
import { instanceError, clearInstanceError, refreshNativeInstances, useInstanceSync } from '../features/instances/native-service';
import { useAccountSync } from '../features/accounts/accounts';
import { prefetchSettingsWhenIdle, useSettingsResourceSync } from '../features/settings/resources';
import { BrowsePage } from '../pages/browse/browse-page';
import { CreatePage } from '../pages/create/create-page';
import { LibraryPage } from '../pages/library/library-page';
import { SettingsPage } from '../pages/settings/settings-page';
import { Rail } from './rail';
import { route } from './router';
import { Titlebar } from './titlebar';
import { goBack } from './transition';
import './shell.css';
import '../styles/reduced-motion.css';
import { useInstanceShortcutRuntime } from '../features/instances/shortcut-runtime';
import { useShortcutRuntime } from '../features/settings/shortcut-runtime';

/** Window frame: titlebar across the top, then the rail beside the scene. */
export function Shell() {
  onSettled(() => startNativeFileDrop());
  useNavigationPreloading();
  useAccountSync();
  useShortcutRuntime();
  useSettingsResourceSync();
  prefetchSettingsWhenIdle();
  useInstanceSync();
  useInstanceShortcutRuntime();
  useMouseBack();
  let dropElement: HTMLElement | undefined;
  useNativeDropZone({ element: () => dropElement, disabled: () => route().page === 'create', drop: reviewUntargetedDrop });

  return (
    <div data-vesta="shell">
      <Titlebar />
      <AccountLoginDialog />
      <TooltipHints />
      <ToastRegion />
      <LinkPreview />
      <ExternalLinkDialog />
      <DropTargetDialog />
      <NativeImportDialog />
      <InstanceDeleteDialog />
      <Show when={instanceError()}><div data-vesta="instance-service-error" role="alert">
        <span>{instanceError()}</span>
        <Button size="sm" variant="ghost" onClick={()=>{clearInstanceError();void refreshNativeInstances(true);}}>{t('common.retry')}</Button>
        <Button size="sm" variant="ghost" onClick={clearInstanceError}>{t('nav.close')}</Button>
      </div></Show>
      <div data-vesta="shell-body">
        <Rail />
        <main ref={(element) => { dropElement = element; }} data-vesta="scene" id="scene" tabindex={-1}>
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
    goBack('/library', findInstance(current.section)?.instance.id);
  };
  const preventNativeBack = (event: MouseEvent) => { if (event.button === 3) event.preventDefault(); };
  window.addEventListener('mousedown', preventNativeBack);
  window.addEventListener('auxclick', preventNativeBack);
  window.addEventListener('mouseup', onMouseUp);
  onCleanup(() => {
    window.removeEventListener('mousedown', preventNativeBack);
    window.removeEventListener('auxclick', preventNativeBack);
    window.removeEventListener('mouseup', onMouseUp);
  });
}
