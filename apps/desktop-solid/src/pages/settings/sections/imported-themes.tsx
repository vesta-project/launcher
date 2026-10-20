import { Button, Dialog } from '@vesta/ui';
import { For, Show, createSignal, onCleanup } from 'solid-js';
import {
  appearanceSnapshot, authorThemePreview, authorThemesAvailable, authorThemesError,
  cancelAuthorThemePreview, disableAuthorTheme, importAuthorTheme,
  removeAuthorTheme, tryAuthorTheme,
} from '../../../features/settings/author-themes';
import { drainSettings } from '../../../features/settings/config';
import { MAX_THEME_FILE_BYTES } from '../../../features/settings/author-theme-model';
import { t } from '../../../localization';
import { Card } from '../parts';

/** Native validation/confirmation owns application; this UI never injects a chosen file. */
export function ImportedThemes() {
  let picker!: HTMLInputElement;
  let disposed = false;
  const [busy, setBusy] = createSignal(false, { name: 'importedThemesBusy' });
  const [error, setError] = createSignal<string | undefined>(undefined, { name: 'importedThemesError' });
  const [status, setStatus] = createSignal<string | undefined>(undefined, { name: 'importedThemesStatus' });
  const [removing, setRemoving] = createSignal<{ id: string; name: string } | undefined>(undefined, { name: 'importedThemeRemoval' });
  const run = async (operation: () => Promise<unknown>, message?: () => string) => {
    if (busy()) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      await drainSettings();
      if (disposed) return;
      await operation();
      if (!disposed && message) setStatus(message());
    } catch (reason) {
      if (!disposed) setError(String(reason));
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  onCleanup(() => {
    disposed = true;
    void cancelAuthorThemePreview().catch(() => {});
  });

  return (
    <Card title={t('prefs.appearance.imported')}>
      <div data-vesta="prefs-imported-themes">
        <p data-vesta="prefs-imported-note">{t('prefs.appearance.imported-description')}</p>
        <Show when={authorThemesAvailable} fallback={
          <p data-vesta="prefs-imported-note">{t('prefs.appearance.imported-desktop-only')}</p>
        }>
          <div data-vesta="prefs-imported-actions">
            <input
              ref={(element) => { picker = element; }}
              type="file"
              accept=".css,.vestatheme,text/css,application/json"
              hidden
              aria-label={t('prefs.appearance.import-file')}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                void run(async () => {
                  if (file.size > MAX_THEME_FILE_BYTES)
                    throw new Error(t('prefs.appearance.import-too-large'));
                  await importAuthorTheme(file);
                }, () => t('prefs.appearance.imported-success'));
              }}
            />
            <Button variant="outline" disabled={busy() || !appearanceSnapshot()} onClick={() => picker.click()}>
              {t('prefs.appearance.import-file')}
            </Button>
            <Show when={appearanceSnapshot()?.selected}>
              <Button variant="outline" disabled={busy()} onClick={() => void run(disableAuthorTheme)}>
                {t('prefs.appearance.restore-built-in')}
              </Button>
            </Show>
          </div>
          <Show when={appearanceSnapshot()?.imports.length === 0}>
            <p data-vesta="prefs-imported-note">{t('prefs.appearance.imported-empty')}</p>
          </Show>
          <ul data-vesta="prefs-imported-list" aria-label={t('prefs.appearance.imported')} aria-busy={busy() ? 'true' : 'false'}>
            <For each={appearanceSnapshot()?.imports}>
              {(entry) => (
                <li data-vesta="prefs-imported-entry">
                  <div data-vesta="prefs-imported-name">
                    <strong>{entry.name}</strong>
                    <span>{t(appearanceSnapshot()?.selected === entry.id ? 'prefs.appearance.imported-active' : 'prefs.appearance.imported-inactive')}</span>
                  </div>
                  <div data-vesta="prefs-imported-actions">
                    <Button variant="outline" disabled={busy()} onClick={() => void run(
                      () => tryAuthorTheme(entry.id), () => t('prefs.appearance.preview-ended'),
                    )}>
                      {t('prefs.appearance.try-theme')}
                    </Button>
                    <Button variant="ghost" tone="danger" disabled={busy()} onClick={() => setRemoving({ id: entry.id, name: entry.name })}>
                      {t('prefs.appearance.remove-theme')}
                    </Button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={authorThemePreview()}>
          <p role="status">{t('prefs.appearance.preview-native')}</p>
        </Show>
        <Show when={status()}>{(message) => <p role="status">{message()}</p>}</Show>
        <Show when={error() ?? authorThemesError() ?? appearanceSnapshot()?.warning}>
          {(message) => <p data-vesta="prefs-imported-error" role="alert">{message()}</p>}
        </Show>
        <p data-vesta="prefs-imported-note">{t('prefs.appearance.imported-recovery')}</p>
      </div>
      <Dialog
        closeLabel={t('nav.close')}
        size="sm"
        title={t('prefs.appearance.remove-theme')}
        description={t('prefs.appearance.remove-theme-description', { name: removing()?.name ?? '' })}
        open={!!removing()}
        onOpenChange={(open) => { if (!open) setRemoving(undefined); }}
        footer={<>
          <Button variant="ghost" onClick={() => setRemoving(undefined)}>{t('common.cancel')}</Button>
          <Button tone="danger" onClick={() => {
            const entry = removing();
            setRemoving(undefined);
            if (entry) void run(() => removeAuthorTheme(entry.id));
          }}>{t('prefs.appearance.remove-theme')}</Button>
        </>}
      />
    </Card>
  );
}
