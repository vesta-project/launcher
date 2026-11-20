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

/** The places a game might want, from its own folder outwards; a preset reaches the first few. */
const places = ['prefs.sandbox.reach-instance', 'prefs.sandbox.reach-game', 'prefs.sandbox.reach-home'] as const;

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
  /** The sandbox wraps the wrapper (the default), or the other way round. */
  const outerFirst = () => setting('default_sandbox_wrapper_nesting') !== 'wrapper-outside';
  const hasHooks = () =>
    !!(setting('default_pre_launch_hook') || setting('default_wrapper_command') || setting('default_post_exit_hook'));
  return (
    <>
      {/*
        What the game may reach: the presets, then plainly what the chosen one lets it touch, and
        the order the wrapper and sandbox wrap the game in, as one line with a swap.
      */}
      <Card title={t('prefs.sandbox.preset')} description={t('prefs.sandbox.preset-description')}>
        <div data-vesta="prefs-sandbox" data-preset={preset().id}>
          <ul data-vesta="prefs-presets" role="radiogroup" aria-label={t('prefs.sandbox.preset')}>
            <For each={presets}>
              {(entry) => (
                <li>
                  <button type="button" role="radio" data-preset={entry.id}
                    aria-checked={preset().id === entry.id ? 'true' : 'false'}
                    data-tip={t(entry.text)}
                    aria-label={t(entry.text)} onClick={() => updateSetting('default_sandbox_preset', entry.id)}>
                    <Icon name={entry.icon} size={20} />
                    <strong>{t(entry.name)}</strong>
                  </button>
                </li>
              )}
            </For>
          </ul>

          <dl data-vesta="prefs-sandbox-facts">
            <dt>{t('prefs.sandbox.reach')}</dt>
            <dd>
              <ul data-vesta="prefs-reach">
                <For each={[...places]}>
                  {(place, index) => (
                    <li data-allowed={index() < preset().reach ? '' : undefined}>
                      <Icon name={index() < preset().reach ? 'icons/controls/check' : 'icons/actions/close'} size={14} />
                      {t(place)}
                    </li>
                  )}
                </For>
              </ul>
            </dd>
            <dt>{t('prefs.sandbox.nesting')}</dt>
            <dd data-vesta="prefs-order" data-tip={t('prefs.sandbox.nesting-description')}>
              <span>{t(outerFirst() ? 'prefs.sandbox.layer-sandbox' : 'prefs.sandbox.layer-wrapper')}</span>
              <Icon name="icons/controls/chevron-right" size={12} />
              <span>{t(outerFirst() ? 'prefs.sandbox.layer-wrapper' : 'prefs.sandbox.layer-sandbox')}</span>
              <Icon name="icons/controls/chevron-right" size={12} />
              <span>{t('prefs.sandbox.layer-game')}</span>
              <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/swap" />}
                aria-label={t(outerFirst() ? 'prefs.sandbox.nesting-wrapper' : 'prefs.sandbox.nesting-sandbox')}
                onClick={() => updateSetting('default_sandbox_wrapper_nesting', (outerFirst() ? 'wrapper-outside' : 'sandbox-outside') as never)}>
                {t('prefs.sandbox.swap')}
              </Button>
            </dd>
          </dl>
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
