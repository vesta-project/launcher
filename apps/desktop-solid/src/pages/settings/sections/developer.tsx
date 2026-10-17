import { invoke, isTauri } from '@tauri-apps/api/core';
import { Button } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { setting, updateSetting } from '../../../features/settings/config';
import { t } from '../../../localization';
import { Callout, Card, ToggleRow } from '../parts';

/** Diagnostic actions. They need the desktop host; in a browser they are disabled. */
const actions = [
  {
    id: 'notification',
    label: 'prefs.developer.reset-notifications',
    text: 'prefs.developer.reset-notifications-description',
    button: 'prefs.developer.reset-action',
    command: 'reset_notification_system',
  },
  {
    id: 'demo',
    label: 'prefs.developer.demo-account',
    text: 'prefs.developer.demo-account-description',
    button: 'prefs.developer.demo-action',
    command: 'start_demo_session',
  },
  {
    id: 'panic',
    label: 'prefs.developer.panic',
    text: 'prefs.developer.panic-description',
    button: 'prefs.developer.panic-action',
    command: 'trigger_test_panic',
    danger: true,
  },
] as const;

export function DeveloperSettings() {
  const [message, setMessage] = createSignal('');
  const run = async (command: string) => {
    try {
      await invoke(command);
      setMessage(t('prefs.developer.done'));
    } catch (reason) {
      setMessage(String(reason));
    }
  };
  return (
    <>
      <Card title={t('prefs.developer.debug')}>
        <ToggleRow
          label={t('prefs.developer.debug-logging')}
          description={t('prefs.developer.debug-logging-description')}
          checked={setting('debug_logging')}
          onChange={(value) => updateSetting('debug_logging', value)}
        />
      </Card>
      <Card title={t('prefs.developer.tools')} description={t('prefs.developer.warning')}>
        <For each={actions}>
          {(action) => (
            <SettingRow label={t(action.label)} description={t(action.text)}>
              <Button
                variant="outline"
                tone={'danger' in action ? 'danger' : undefined}
                disabled={!isTauri()}
                title={isTauri() ? undefined : t('prefs.needs-desktop')}
                icon={<Icon name="icons/content/terminal" size={14} />}
                onClick={() => void run(action.command)}
              >
                {t(action.button)}
              </Button>
            </SettingRow>
          )}
        </For>
        <SettingRow label={t('prefs.developer.error')} description={t('prefs.developer.error-description')}>
          <Button
            variant="outline"
            tone="danger"
            onClick={() => {
              throw new Error('Test error from Settings → Developer');
            }}
          >
            {t('prefs.developer.error-action')}
          </Button>
        </SettingRow>
        <Show when={message()}>
          <Callout>{message()}</Callout>
        </Show>
      </Card>
    </>
  );
}
