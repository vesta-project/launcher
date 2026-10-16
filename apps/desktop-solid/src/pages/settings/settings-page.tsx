import {
  Button,
  Checkbox,
  Dialog,
  NumberField,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { accounts, activeAccount, addAccount, removeAccount, switchAccount } from '../../features/accounts/accounts';
import { hue, scheme, setHue, setScheme, type SchemePreference } from '../../app/preferences';
import { navigate, route } from '../../app/router';
import { Icon } from '../../components/icon';
import { Board } from '../../components/board';
import { isSection, type SectionId } from './sections';
import { SettingRow, SettingsSection } from '../../components/setting-row';
import { getSupportedLocales, languagePreference, setLocale, SYSTEM_LANGUAGE, t, type LocalePreference } from '../../localization';
import './settings-page.css';


function GeneralSettings() {
  const [closeOnLaunch, setCloseOnLaunch] = createSignal(false);
  const [updates, setUpdates] = createSignal(true);
  const [crashReports, setCrashReports] = createSignal(true);
  const languageOptions = () => [
    { value: SYSTEM_LANGUAGE, label: t('common.system-default') },
    ...getSupportedLocales().map((locale) => ({
      value: locale.code,
      label: locale.nativeName,
    })),
  ];

  return (
    <>
      <SettingsSection title={t('settings.launching')} description={t('settings.launching-description')}>
        <SettingRow label={t('settings.close-on-start')} description={t('settings.close-on-start-description')}>
          <Switch checked={closeOnLaunch()} onChange={setCloseOnLaunch} aria-label={t('settings.close-on-start')} />
        </SettingRow>
        <SettingRow label={t('settings.check-updates')}>
          <Switch checked={updates()} onChange={setUpdates} aria-label={t('settings.check-updates')} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.language-privacy')}>
        <SettingRow label={t('settings.language-label')} description={t('settings.language-description')}>
          <Select
            size="sm"
            aria-label={t('settings.language-aria')}
            value={languagePreference()}
            onChange={(preference) => setLocale(preference as LocalePreference)}
            options={languageOptions()}
            style={{ width: '160px' }}
          />
        </SettingRow>
        <SettingRow label={t('settings.crash-reports')} description={t('settings.crash-reports-description')}>
          <Checkbox checked={crashReports()} onChange={setCrashReports} aria-label={t('settings.crash-reports')} />
        </SettingRow>
      </SettingsSection>
    </>
  );
}

function AppearanceSettings() {
  return (
    <SettingsSection title={t('settings.theme')} description={t('settings.theme-description')}>
      <SettingRow label={t('settings.colour-scheme')}>
        <SegmentedControl
          size="sm"
          aria-label={t('settings.colour-scheme')}
          value={scheme()}
          onChange={(value) => setScheme(value as SchemePreference)}
          options={[
            { value: 'system', label: t('settings.system') },
            { value: 'light', label: t('settings.light') },
            { value: 'dark', label: t('settings.dark') },
          ]}
        />
      </SettingRow>
      <SettingRow label={t('settings.accent-colour')} description={t('settings.accent-description')}>
        <div style={{ width: '220px' }}>
          <Slider size="sm" aria-label={t('settings.accent-colour')} min={0} max={360} step={1} value={[hue()]} onChange={(value) => setHue(value[0])} showValue />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setHue(185)}>
          {t('settings.reset')}
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}

function AccountSettings() {
  return (
    <>
      <SettingsSection title={t('settings.accounts')} description={t('settings.accounts-description')}>
        <For each={accounts()}>
          {(account) => (
            <SettingRow
              label={account.username}
              description={`${account.account_type}${account.uuid === activeAccount()?.uuid ? ` · ${t('settings.active-account')}` : ''}${account.is_expired ? ` · ${t('settings.expired-account')}` : ''}`}
            >
              <Show when={account.uuid !== activeAccount()?.uuid}>
                <Button size="sm" variant="outline" onClick={() => void switchAccount(account.uuid)}>
                  {t('settings.make-active')}
                </Button>
              </Show>
              <Button size="sm" variant="ghost" tone="danger" onClick={() => void removeAccount(account.uuid)}>
                {t('common.remove')}
              </Button>
            </SettingRow>
          )}
        </For>
        <SettingRow label={t('settings.add-account')} description={t('settings.add-account-description')}>
          <Button size="sm" tone="accent" icon={<Icon name="icons/actions/add" size={14} />} onClick={() => void addAccount()}>
            {t('settings.add-microsoft-account')}
          </Button>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title={t('settings.skin')} description={t('settings.skin-description')}>
        <SettingRow label={t('settings.change-skin')}>
          <Button size="sm" variant="outline" disabled>
            {t('settings.open-skin-editor')}
          </Button>
        </SettingRow>
      </SettingsSection>
    </>
  );
}

function JavaSettings() {
  const [runtime, setRuntime] = createSignal('auto');
  const [memory, setMemory] = createSignal(4096);
  const [args, setArgs] = createSignal('-XX:+UseG1GC');

  return (
    <SettingsSection title={t('settings.java')} description={t('settings.java-description')}>
      <SettingRow label={t('settings.java-runtime')} description={t('settings.java-runtime-description')}>
        <Select
          size="sm"
          aria-label={t('settings.java-runtime')}
          value={runtime()}
          onChange={setRuntime}
          options={[
            { value: 'auto', label: t('settings.automatic') },
            { value: '21', label: t('settings.java-bundled', { version: '21' }) },
            { value: '17', label: t('settings.java-version', { version: '17' }) },
            { value: '8', label: t('settings.java-version', { version: '8' }) },
          ]}
          style={{ width: '180px' }}
        />
      </SettingRow>
      <SettingRow label={t('settings.maximum-memory')}>
        <NumberField size="sm" aria-label={t('settings.maximum-memory-aria')} value={memory()} onChange={setMemory} min={1024} max={32768} step={512} style={{ width: '140px' }} />
      </SettingRow>
      <SettingRow label={t('settings.jvm-arguments')}>
        <TextField size="sm" aria-label={t('settings.jvm-arguments')} value={args()} onChange={setArgs} style={{ width: '260px' }} />
      </SettingRow>
    </SettingsSection>
  );
}

function AdvancedSettings() {
  const [devMode, setDevMode] = createSignal(false);
  const [logLevel, setLogLevel] = createSignal('info');
  const [resetOpen, setResetOpen] = createSignal(false);

  return (
    <>
      <SettingsSection title={t('settings.diagnostics')}>
        <SettingRow label={t('settings.developer-mode')} description={t('settings.developer-mode-description')}>
          <Switch checked={devMode()} onChange={setDevMode} aria-label={t('settings.developer-mode')} />
        </SettingRow>
        <SettingRow label={t('settings.log-level')}>
          <Select
            size="sm"
            aria-label={t('settings.log-level')}
            value={logLevel()}
            onChange={setLogLevel}
            options={[
              { value: 'error', label: t('settings.errors-only') },
              { value: 'info', label: t('settings.info') },
              { value: 'debug', label: t('settings.debug') },
            ]}
            style={{ width: '140px' }}
          />
        </SettingRow>
        <SettingRow label={t('settings.data-folder')} description={t('settings.data-folder-description')}>
          <Button size="sm" variant="outline" icon={<Icon name="icons/content/folder" size={14} />}>
            {t('settings.open')}
          </Button>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.reset')}>
        <SettingRow label={t('settings.reset-title')} description={t('settings.reset-description')}>
          <Dialog
            open={resetOpen()}
            onOpenChange={setResetOpen}
            size="sm"
            title={t('settings.reset-confirm-title')}
            description={t('settings.reset-confirm-description')}
            trigger={(props) => (
              <Button {...props} size="sm" tone="danger" variant="outline">
                {t('settings.reset-action')}
              </Button>
            )}
            footer={
              <>
                <Button variant="ghost" onClick={() => setResetOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button tone="danger" onClick={() => setResetOpen(false)}>
                  {t('settings.reset-button')}
                </Button>
              </>
            }
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}

export function SettingsPage() {
  const active = (): SectionId => {
    const section = route().section;
    return isSection(section) ? section : 'general';
  };

  const entries = [
    { id: 'general', label: 'settings.general', icon: 'icons/content/sliders', view: GeneralSettings },
    { id: 'appearance', label: 'settings.appearance', icon: 'icons/content/layers', view: AppearanceSettings },
    { id: 'account', label: 'settings.account', icon: 'icons/content/skin-icon', view: AccountSettings },
    { id: 'java', label: 'settings.java', icon: 'icons/content/code', view: JavaSettings },
    { id: 'advanced', label: 'settings.advanced', icon: 'icons/content/terminal', view: AdvancedSettings },
  ] as const;

  return (
    <Board>
      <Tabs orientation="vertical" value={active()} onChange={(value) => navigate(`/settings/${value}`)} class="settings-tabs">
        <TabList aria-label={t('settings.sections-aria')}>
          <For each={entries}>
            {(entry) => (
              <Tab value={entry.id} icon={<Icon name={entry.icon} size={14} />}>
                {t(entry.label)}
              </Tab>
            )}
          </For>
        </TabList>
        <For each={entries}>
          {(entry) => (
            <TabPanel value={entry.id}>
              <div data-vesta="settings-content">
                <entry.view />
              </div>
            </TabPanel>
          )}
        </For>
      </Tabs>
    </Board>
  );
}
