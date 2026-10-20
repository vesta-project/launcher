import { Button, SegmentedControl } from '@vesta/ui';
import { setting, updateSetting } from '../../features/settings/config';
import { onboarding } from '../../features/onboarding';
import { t } from '../../localization';
import { ThemeGrid } from '../settings/sections/appearance';

/** Step 4: the same live theme tiles as Settings → Appearance, plus the colour mode. */
export function ThemeStep() {
  return (
    <div data-vesta="welcome-theme">
      <header data-vesta="welcome-head">
        <h2 data-vesta="welcome-title">{t('welcome.theme-title')}</h2>
        <p data-vesta="welcome-lead">{t('welcome.theme-lead')}</p>
      </header>

      <div data-vesta="welcome-theme-grid">
        <ThemeGrid />
      </div>

      <footer data-vesta="welcome-foot">
        <Button variant="ghost" onClick={() => void onboarding.back()}>
          {t('common.back')}
        </Button>
        <SegmentedControl
          size="sm"
          aria-label={t('prefs.appearance.color-mode')}
          value={setting('theme')}
          onChange={(value) => updateSetting('theme', value as never)}
          options={[
            { value: 'system', label: t('prefs.appearance.mode-system') },
            { value: 'light', label: t('prefs.appearance.mode-light') },
            { value: 'dark', label: t('prefs.appearance.mode-dark') },
          ]}
        />
        <span data-vesta="welcome-foot-spacer" />
        <Button tone="accent" onClick={() => void onboarding.next()}>
          {t('welcome.continue')}
        </Button>
      </footer>
    </div>
  );
}
