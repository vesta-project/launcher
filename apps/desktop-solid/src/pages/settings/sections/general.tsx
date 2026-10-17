import { Select } from '@vesta/ui';
import { setting, updateSetting } from '../../../features/settings/config';
import { SettingRow } from '../../../components/setting-row';
import {
  getSupportedLocales,
  languagePreference,
  setLocale,
  SYSTEM_LANGUAGE,
  t,
  type LocalePreference,
} from '../../../localization';
import { Card, ToggleRow } from '../parts';

export function GeneralSettings() {
  const languages = () => [
    { value: SYSTEM_LANGUAGE, label: t('common.system-default') },
    ...getSupportedLocales().map((locale) => ({
      value: locale.code,
      label: locale.nativeName,
    })),
  ];
  return (
    <>
      <Card title={t('prefs.general.display')}>
        <SettingRow label={t('prefs.general.language')} description={t('prefs.general.language-description')}>
          <Select
            aria-label={t('prefs.general.language')}
            value={languagePreference()}
            options={languages()}
            onChange={(value) => {
              setLocale(value as LocalePreference);
              updateSetting('language', value);
            }}
          />
        </SettingRow>
        <ToggleRow
          label={t('prefs.general.reduced-motion')}
          description={t('prefs.general.reduced-motion-description')}
          checked={setting('reduced_motion')}
          onChange={(value) => updateSetting('reduced_motion', value)}
        />
      </Card>

      <Card title={t('prefs.general.startup')}>
        <ToggleRow
          label={t('prefs.general.autostart')}
          description={t('prefs.general.autostart-description')}
          checked={setting('autostart_enabled')}
          onChange={(value) => updateSetting('autostart_enabled', value)}
        />
        <ToggleRow
          label={t('prefs.general.tray')}
          description={t('prefs.general.tray-description')}
          checked={setting('show_tray_icon')}
          onChange={(value) => updateSetting('show_tray_icon', value)}
        />
        <ToggleRow
          label={t('prefs.general.close-to-tray')}
          description={t('prefs.general.close-to-tray-description')}
          checked={setting('minimize_to_tray')}
          onChange={(value) => updateSetting('minimize_to_tray', value)}
        />
      </Card>

      <Card title={t('prefs.general.performance')}>
        <ToggleRow
          label={t('prefs.general.gpu')}
          description={t('prefs.general.gpu-description')}
          checked={setting('use_dedicated_gpu')}
          onChange={(value) => updateSetting('use_dedicated_gpu', value)}
        />
      </Card>

      <Card title={t('prefs.general.privacy')}>
        <ToggleRow
          label={t('prefs.general.telemetry')}
          description={t('prefs.general.telemetry-description')}
          checked={setting('telemetry_enabled')}
          onChange={(value) => updateSetting('telemetry_enabled', value)}
        />
        <ToggleRow
          label={t('prefs.general.discord')}
          description={t('prefs.general.discord-description')}
          checked={setting('discord_presence_enabled')}
          onChange={(value) => updateSetting('discord_presence_enabled', value)}
        />
      </Card>

      <Card title={t('prefs.general.advanced')}>
        <ToggleRow
          label={t('prefs.general.developer-mode')}
          description={t('prefs.general.developer-mode-description')}
          checked={setting('developer_mode')}
          onChange={(value) => updateSetting('developer_mode', value)}
        />
      </Card>
    </>
  );
}
