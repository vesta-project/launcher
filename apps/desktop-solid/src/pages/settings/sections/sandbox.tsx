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
    name: 'prefs.sandbox.preset-trusted',
    text: 'prefs.sandbox.preset-trusted-description',
  },
  {
    id: 'modded',
    name: 'prefs.sandbox.preset-modded',
    text: 'prefs.sandbox.preset-modded-description',
  },
  {
    id: 'paranoid',
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
  const presetText = () => (presets.find((preset) => preset.id === setting('default_sandbox_preset')) ?? presets[0]).text;
  const hasHooks = () =>
    !!(setting('default_pre_launch_hook') || setting('default_wrapper_command') || setting('default_post_exit_hook'));
  return (
    <>
      {/* The presets are steps on one scale, from open to shut, so they read as one control. */}
      <Card title={t('prefs.sandbox.preset')} description={t('prefs.sandbox.preset-description')}>
        <div data-vesta="prefs-block">
          <SegmentedControl
            fill
            aria-label={t('prefs.sandbox.preset')}
            value={setting('default_sandbox_preset')}
            onChange={(value) => updateSetting('default_sandbox_preset', value as never)}
            options={presets.map((preset) => ({ value: preset.id, label: t(preset.name) }))}
          />
          <p data-vesta="prefs-preset-note">{t(presetText())}</p>
        </div>
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
