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
import { SettingRow, SettingsSection } from './setting-row';
import './settings-page.css';


function GeneralSettings() {
  const [closeOnLaunch, setCloseOnLaunch] = createSignal(false);
  const [updates, setUpdates] = createSignal(true);
  const [language, setLanguage] = createSignal('en');
  const [crashReports, setCrashReports] = createSignal(true);

  return (
    <>
      <SettingsSection title="Launching" description="What happens when you start the game.">
        <SettingRow label="Close launcher when the game starts" description="Reopens automatically when the game exits.">
          <Switch checked={closeOnLaunch()} onChange={setCloseOnLaunch} aria-label="Close launcher when the game starts" />
        </SettingRow>
        <SettingRow label="Check for updates on startup">
          <Switch checked={updates()} onChange={setUpdates} aria-label="Check for updates on startup" />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Language and privacy">
        <SettingRow label="Language">
          <Select
            size="sm"
            aria-label="Language"
            value={language()}
            onChange={setLanguage}
            options={[
              { value: 'en', label: 'English' },
              { value: 'de', label: 'Deutsch' },
              { value: 'fr', label: 'Français' },
              { value: 'ja', label: '日本語' },
            ]}
            style={{ width: '160px' }}
          />
        </SettingRow>
        <SettingRow label="Share anonymous crash reports" description="Helps find launcher bugs. Never includes your world data.">
          <Checkbox checked={crashReports()} onChange={setCrashReports} aria-label="Share anonymous crash reports" />
        </SettingRow>
      </SettingsSection>
    </>
  );
}

function AppearanceSettings() {
  return (
    <SettingsSection title="Theme" description="Colours follow your system by default.">
      <SettingRow label="Colour scheme">
        <SegmentedControl
          size="sm"
          aria-label="Colour scheme"
          value={scheme()}
          onChange={(value) => setScheme(value as SchemePreference)}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </SettingRow>
      <SettingRow label="Accent colour" description="Tints buttons, focus rings and the current page.">
        <div style={{ width: '220px' }}>
          <Slider size="sm" aria-label="Accent hue" min={0} max={360} step={1} value={[hue()]} onChange={(value) => setHue(value[0])} showValue />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setHue(185)}>
          Reset
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}

function AccountSettings() {
  return (
    <>
      <SettingsSection title="Accounts" description="The active account is used to launch the game.">
        <For each={accounts()}>
          {(account) => (
            <SettingRow
              label={account.username}
              description={`${account.account_type}${account.uuid === activeAccount()?.uuid ? ' · Active' : ''}${account.is_expired ? ' · Expired' : ''}`}
            >
              <Show when={account.uuid !== activeAccount()?.uuid}>
                <Button size="sm" variant="outline" onClick={() => void switchAccount(account.uuid)}>
                  Make active
                </Button>
              </Show>
              <Button size="sm" variant="ghost" tone="danger" onClick={() => void removeAccount(account.uuid)}>
                Remove
              </Button>
            </SettingRow>
          )}
        </For>
        <SettingRow label="Add an account" description="Sign in with Microsoft to play on your own account.">
          <Button size="sm" tone="accent" icon={<Icon name="icons/actions/add" size={14} />} onClick={() => void addAccount()}>
            Add Microsoft account
          </Button>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Skin" description="Skin editing is coming with the account pages.">
        <SettingRow label="Change skin">
          <Button size="sm" variant="outline" disabled>
            Open skin editor
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
    <SettingsSection title="Java" description="Used by every instance unless it overrides these.">
      <SettingRow label="Java runtime" description="Vesta downloads the right version when needed.">
        <Select
          size="sm"
          aria-label="Java runtime"
          value={runtime()}
          onChange={setRuntime}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: '21', label: 'Java 21 (bundled)' },
            { value: '17', label: 'Java 17' },
            { value: '8', label: 'Java 8' },
          ]}
          style={{ width: '180px' }}
        />
      </SettingRow>
      <SettingRow label="Maximum memory (MB)">
        <NumberField size="sm" aria-label="Maximum memory in megabytes" value={memory()} onChange={setMemory} min={1024} max={32768} step={512} style={{ width: '140px' }} />
      </SettingRow>
      <SettingRow label="JVM arguments">
        <TextField size="sm" aria-label="JVM arguments" value={args()} onChange={setArgs} style={{ width: '260px' }} />
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
      <SettingsSection title="Diagnostics">
        <SettingRow label="Developer mode" description="Shows extra tools and verbose logs.">
          <Switch checked={devMode()} onChange={setDevMode} aria-label="Developer mode" />
        </SettingRow>
        <SettingRow label="Log level">
          <Select
            size="sm"
            aria-label="Log level"
            value={logLevel()}
            onChange={setLogLevel}
            options={[
              { value: 'error', label: 'Errors only' },
              { value: 'info', label: 'Info' },
              { value: 'debug', label: 'Debug' },
            ]}
            style={{ width: '140px' }}
          />
        </SettingRow>
        <SettingRow label="Data folder" description="Instances, accounts and logs live here.">
          <Button size="sm" variant="outline" icon={<Icon name="icons/content/folder" size={14} />}>
            Open
          </Button>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Reset">
        <SettingRow label="Reset all settings" description="Instances and accounts are kept.">
          <Dialog
            open={resetOpen()}
            onOpenChange={setResetOpen}
            size="sm"
            title="Reset all settings?"
            description="Launcher preferences return to their defaults. Your instances, worlds and accounts are not touched."
            trigger={(props) => (
              <Button {...props} size="sm" tone="danger" variant="outline">
                Reset…
              </Button>
            )}
            footer={
              <>
                <Button variant="ghost" onClick={() => setResetOpen(false)}>
                  Cancel
                </Button>
                <Button tone="danger" onClick={() => setResetOpen(false)}>
                  Reset settings
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
    { id: 'general', label: 'General', icon: 'icons/content/sliders', view: GeneralSettings },
    { id: 'appearance', label: 'Appearance', icon: 'icons/content/layers', view: AppearanceSettings },
    { id: 'account', label: 'Account', icon: 'icons/content/skin-icon', view: AccountSettings },
    { id: 'java', label: 'Java', icon: 'icons/content/code', view: JavaSettings },
    { id: 'advanced', label: 'Advanced', icon: 'icons/content/terminal', view: AdvancedSettings },
  ] as const;

  return (
    <Board>
      <Tabs orientation="vertical" value={active()} onChange={(value) => navigate(`/settings/${value}`)} class="settings-tabs">
        <TabList aria-label="Settings sections">
          <For each={entries}>
            {(entry) => (
              <Tab value={entry.id} icon={<Icon name={entry.icon} size={14} />}>
                {entry.label}
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
