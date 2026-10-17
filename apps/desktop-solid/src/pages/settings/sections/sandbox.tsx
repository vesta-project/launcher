import { Button, IconButton, SegmentedControl, TextField } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { setting, updateSetting } from '../../../features/settings/config';
import { t } from '../../../localization';
import { Callout, Card } from '../parts';
import './sandbox.css';

const presets = [
  {
    id: 'trusted',
    icon: 'icons/security/shield-check',
    name: 'prefs.sandbox.preset-trusted',
    text: 'prefs.sandbox.preset-trusted-description',
  },
  {
    id: 'modded',
    icon: 'icons/security/shield',
    name: 'prefs.sandbox.preset-modded',
    text: 'prefs.sandbox.preset-modded-description',
  },
  {
    id: 'paranoid',
    icon: 'icons/security/lock',
    name: 'prefs.sandbox.preset-paranoid',
    text: 'prefs.sandbox.preset-paranoid-description',
  },
] as const;

export function SandboxSettings() {
  const [folder, setFolder] = createSignal('');
  const folders = () => setting('default_sandbox_extra_paths');
  const add = () => {
    const path = folder().trim();
    if (!path || folders().includes(path)) return;
    updateSetting('default_sandbox_extra_paths', [...folders(), path]);
    setFolder('');
  };
  const text = (key: 'default_pre_launch_hook' | 'default_wrapper_command' | 'default_post_exit_hook') => ({
    value: setting(key) ?? '',
    onChange: (value: string) => updateSetting(key, value.trim() ? value : null),
  });
  const hasHooks = () =>
    !!(setting('default_pre_launch_hook') || setting('default_wrapper_command') || setting('default_post_exit_hook'));
  return (
    <>
      <Card title={t('prefs.sandbox.preset')} description={t('prefs.sandbox.preset-description')}>
        <ul data-vesta="prefs-presets" role="radiogroup" aria-label={t('prefs.sandbox.preset')}>
          <For each={presets}>
            {(preset) => (
              <li>
                <button
                  type="button"
                  role="radio"
                  aria-checked={setting('default_sandbox_preset') === preset.id ? 'true' : 'false'}
                  data-preset={preset.id}
                  onClick={() => updateSetting('default_sandbox_preset', preset.id)}
                >
                  <Icon name={preset.icon} size={20} />
                  <strong>{t(preset.name)}</strong>
                  <span>{t(preset.text)}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Card>

      <Card title={t('prefs.sandbox.nesting')} description={t('prefs.sandbox.nesting-description')}>
        <div data-vesta="prefs-block">
          <SegmentedControl
            fill
            aria-label={t('prefs.sandbox.nesting')}
            value={setting('default_sandbox_wrapper_nesting')}
            onChange={(value) => updateSetting('default_sandbox_wrapper_nesting', value as never)}
            options={[
              {
                value: 'sandbox-outside',
                label: t('prefs.sandbox.nesting-sandbox'),
              },
              {
                value: 'wrapper-outside',
                label: t('prefs.sandbox.nesting-wrapper'),
              },
            ]}
          />
        </div>
      </Card>

      <Card title={t('prefs.sandbox.folders')} description={t('prefs.sandbox.folders-description')}>
        <Show when={folders().length}>
          <ul data-vesta="prefs-folders">
            <For each={folders()}>
              {(path) => (
                <li>
                  <Icon name="icons/content/folder" size={16} />
                  <code>{path}</code>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    tone="danger"
                    label={t('prefs.sandbox.remove-folder', { path })}
                    icon={<Icon name="icons/actions/close" />}
                    onClick={() =>
                      updateSetting(
                        'default_sandbox_extra_paths',
                        folders().filter((item) => item !== path),
                      )
                    }
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div data-vesta="prefs-add-folder">
          <TextField
            aria-label={t('prefs.sandbox.folder-path')}
            placeholder={t('prefs.sandbox.folder-placeholder')}
            value={folder()}
            onChange={setFolder}
          />
          <Button
            variant="outline"
            disabled={!folder().trim()}
            icon={<Icon name="icons/actions/add" size={14} />}
            onClick={add}
          >
            {t('prefs.sandbox.add-folder')}
          </Button>
        </div>
      </Card>

      <Card title={t('prefs.sandbox.hooks')} description={t('prefs.sandbox.hooks-description')}>
        <SettingRow label={t('prefs.sandbox.pre-launch')} description={t('prefs.sandbox.pre-launch-description')}>
          <TextField aria-label={t('prefs.sandbox.pre-launch')} {...text('default_pre_launch_hook')} />
        </SettingRow>
        <SettingRow label={t('prefs.sandbox.wrapper')} description={t('prefs.sandbox.wrapper-description')}>
          <TextField
            aria-label={t('prefs.sandbox.wrapper')}
            placeholder="mangohud --dlsym"
            {...text('default_wrapper_command')}
          />
        </SettingRow>
        <SettingRow label={t('prefs.sandbox.post-exit')} description={t('prefs.sandbox.post-exit-description')}>
          <TextField aria-label={t('prefs.sandbox.post-exit')} {...text('default_post_exit_hook')} />
        </SettingRow>
        <Show when={hasHooks() && setting('default_sandbox_preset') !== 'trusted'}>
          <Callout tone="warning">{t('prefs.sandbox.hooks-restricted')}</Callout>
        </Show>
      </Card>
    </>
  );
}
