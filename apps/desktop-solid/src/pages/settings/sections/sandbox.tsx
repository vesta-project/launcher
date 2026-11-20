import { Button, IconButton, TextField } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { setting, updateSetting } from '../../../features/settings/config';
import { t } from '../../../localization';
import { Callout, Card } from '../parts';
import './sandbox.css';

const presets = [
  { id: 'trusted', icon: 'icons/security/shield-off', reach: 3, name: 'prefs.sandbox.preset-trusted', text: 'prefs.sandbox.preset-trusted-description' },
  { id: 'modded', icon: 'icons/security/shield', reach: 2, name: 'prefs.sandbox.preset-modded', text: 'prefs.sandbox.preset-modded-description' },
  { id: 'paranoid', icon: 'icons/security/lock', reach: 1, name: 'prefs.sandbox.preset-paranoid', text: 'prefs.sandbox.preset-paranoid-description' },
] as const;

/** Wrapper order, as the layers around the game from the outside in. */
const nestings = [
  { id: 'sandbox-outside', outer: 'sandbox', inner: 'wrapper', label: 'prefs.sandbox.nesting-sandbox' },
  { id: 'wrapper-outside', outer: 'wrapper', inner: 'sandbox', label: 'prefs.sandbox.nesting-wrapper' },
] as const;

const layerLabels = { sandbox: 'prefs.sandbox.layer-sandbox', wrapper: 'prefs.sandbox.layer-wrapper' } as const;

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
  const preset = () => presets.find((entry) => entry.id === setting('default_sandbox_preset')) ?? presets[0];
  const hasHooks = () =>
    !!(setting('default_pre_launch_hook') || setting('default_wrapper_command') || setting('default_post_exit_hook'));
  return (
    <>
      {/*
        One card for what the game may reach: the presets as a scale from open to locked down
        (each with how far it reaches), and the wrapper order drawn as the layers around the game,
        the sandbox layer in the chosen preset's colour.
      */}
      <Card title={t('prefs.sandbox.preset')} description={t('prefs.sandbox.preset-description')}>
        <div data-vesta="prefs-sandbox" data-preset={preset().id}>
          <ul data-vesta="prefs-presets" role="radiogroup" aria-label={t('prefs.sandbox.preset')}>
            <For each={presets}>
              {(entry) => (
                <li>
                  <button type="button" role="radio" data-preset={entry.id}
                    aria-checked={preset().id === entry.id ? 'true' : 'false'}
                    onClick={() => updateSetting('default_sandbox_preset', entry.id)}>
                    <Icon name={entry.icon} size={20} />
                    <strong>{t(entry.name)}</strong>
                    <span data-vesta="prefs-preset-reach" aria-hidden="true">
                      <For each={[1, 2, 3]}>{(step) => <i data-on={step <= entry.reach ? '' : undefined} />}</For>
                    </span>
                    <small>{t(entry.text)}</small>
                  </button>
                </li>
              )}
            </For>
          </ul>

          <div data-vesta="prefs-nesting">
            <div>
              <strong>{t('prefs.sandbox.nesting')}</strong>
              <small>{t('prefs.sandbox.nesting-description')}</small>
            </div>
            <ul role="radiogroup" aria-label={t('prefs.sandbox.nesting')}>
              <For each={nestings}>
                {(entry) => (
                  <li>
                    <button type="button" role="radio" aria-label={t(entry.label)}
                      aria-checked={setting('default_sandbox_wrapper_nesting') === entry.id ? 'true' : 'false'}
                      onClick={() => updateSetting('default_sandbox_wrapper_nesting', entry.id as never)}>
                      <span data-vesta="prefs-layer" data-layer={entry.outer}>
                        <small>{t(layerLabels[entry.outer])}</small>
                        <span data-vesta="prefs-layer" data-layer={entry.inner}>
                          <small>{t(layerLabels[entry.inner])}</small>
                          <span data-vesta="prefs-layer" data-layer="game"><small>{t('prefs.sandbox.layer-game')}</small></span>
                        </span>
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
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
