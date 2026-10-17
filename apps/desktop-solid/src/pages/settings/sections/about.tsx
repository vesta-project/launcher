import { getVersion } from '@tauri-apps/api/app';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { Button, Dialog } from '@vesta/ui';
import { For, Show, createSignal, onSettled } from 'solid-js';
import { navigate } from '../../../app/router';
import { ImportDialog } from '../../create/import-dialog';
import { openInstallSource } from '../../create/install-navigation';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { resetConfig, setting, updateSetting } from '../../../features/settings/config';
import { updateStatus, checkForUpdates } from '../../../features/settings/updates';
import { t } from '../../../localization';
import { Card, ToggleRow } from '../parts';
import './about.css';

const links = [
  {
    label: 'prefs.about.github',
    host: 'github.com/vesta-project/launcher',
    url: 'https://github.com/vesta-project/launcher',
    icon: 'icons/content/code',
  },
  {
    label: 'prefs.about.discord',
    host: 'discord.gg/zuDNHNHk8E',
    url: 'https://discord.gg/zuDNHNHk8E',
    icon: 'icons/content/chat',
  },
  {
    label: 'prefs.about.license',
    host: 'gnu.org/licenses/gpl-3.0',
    url: 'https://www.gnu.org/licenses/gpl-3.0.html',
    icon: 'icons/content/file',
  },
];

const openLink = (url: string) => (isTauri() ? void openExternal(url) : void window.open(url, '_blank', 'noopener'));

export function AboutSettings() {
  const [version, setVersion] = createSignal('0.2.0-dev');
  const status = () => updateStatus().state;
  const [resetting, setResetting] = createSignal(false);
  const [importing, setImporting] = createSignal(false);
  const checkNow = () => void checkForUpdates();
  onSettled(() => {
    if (isTauri()) void getVersion().then(setVersion);
  });
  return (
    <>
      <Show when={importing()}>
        <ImportDialog
          open
          initialStep="launchers"
          onClose={() => setImporting(false)}
          onSource={openInstallSource}
          onLauncher={(kind) => navigate(`/create/import/${kind}`)}
        />
      </Show>
      <section data-vesta="prefs-about">
        <img src="/favicon.ico" alt="" width="56" height="56" draggable="false" />
        <div>
          <h3>Vesta Launcher</h3>
          <p>{t('prefs.about.version', { version: version() })}</p>
        </div>
        <div data-vesta="prefs-about-update">
          <Show when={status() !== 'idle'}>
            <span data-vesta="prefs-about-status" data-state={status()} role="status">
              <Show when={status() === 'current'}>
                <Icon name="icons/controls/success" size={14} />
              </Show>
              {status() === 'error'
                ? updateStatus().error
                : status() === 'checking'
                  ? t('prefs.about.checking')
                  : status() === 'current'
                    ? t('prefs.about.up-to-date')
                    : `${t('prefs.about.update-available')} ${updateStatus().version ?? ''}`}
            </span>
          </Show>
          <Button
            variant="outline"
            disabled={status() === 'checking'}
            icon={<Icon name="icons/actions/refresh" />}
            onClick={checkNow}
          >
            {t('prefs.about.check-now')}
          </Button>
        </div>
      </section>

      <Card title={t('prefs.about.updates')}>
        <ToggleRow
          label={t('prefs.about.auto-update')}
          description={t('prefs.about.auto-update-description')}
          checked={setting('auto_update_enabled')}
          onChange={(value) => updateSetting('auto_update_enabled', value)}
        />
        <ToggleRow
          label={t('prefs.about.startup-check')}
          description={t('prefs.about.startup-check-description')}
          checked={setting('startup_check_updates')}
          onChange={(value) => updateSetting('startup_check_updates', value)}
        />
        <SettingRow label={t('prefs.about.changelog')} description={t('prefs.about.changelog-description')}>
          <Button
            variant="outline"
            icon={<Icon name="icons/content/history" />}
            disabled
            title={t('prefs.coming-soon')}
          >
            {t('prefs.about.view')}
          </Button>
        </SettingRow>
      </Card>

      <Card title={t('prefs.about.help')}>
        <SettingRow label={t('prefs.about.docs')} description={t('prefs.about.docs-description')}>
          <Button
            variant="outline"
            icon={<Icon name="icons/actions/external-link" />}
            disabled
            title={t('prefs.coming-soon')}
          >
            {t('prefs.about.open')}
          </Button>
        </SettingRow>
        <SettingRow label={t('prefs.about.tutorial')} description={t('prefs.about.tutorial-description')}>
          <Button variant="outline" disabled title={t('prefs.coming-soon')}>
            {t('prefs.about.run')}
          </Button>
        </SettingRow>
        <SettingRow label={t('prefs.about.importer')} description={t('prefs.about.importer-description')}>
          <Button variant="outline" onClick={() => setImporting(true)}>
            {t('prefs.about.open')}
          </Button>
        </SettingRow>
      </Card>

      <Card title={t('prefs.about.community')} description={t('prefs.about.licensed')}>
        <ul data-vesta="prefs-links">
          <For each={links}>
            {(link) => (
              <li>
                <button type="button" onClick={() => openLink(link.url)}>
                  <span data-vesta="prefs-link-tile">
                    <Icon name={link.icon} size={16} />
                  </span>
                  <span data-vesta="prefs-link-text">
                    <strong>{t(link.label as never)}</strong>
                    <small>{link.host}</small>
                  </span>
                  <Icon name="icons/actions/external-link" size={14} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Card>

      <Card title={t('prefs.about.reset')} danger>
        <SettingRow
          label={t('prefs.about.reset-onboarding')}
          description={t('prefs.about.reset-onboarding-description')}
        >
          <Button variant="outline" onClick={() => isTauri() && void invoke('reset_onboarding')}>
            {t('prefs.about.redo-setup')}
          </Button>
        </SettingRow>
        <SettingRow label={t('prefs.about.reset-settings')} description={t('prefs.about.reset-settings-description')}>
          <Button tone="danger" variant="outline" onClick={() => setResetting(true)}>
            {t('prefs.about.reset-action')}
          </Button>
        </SettingRow>
      </Card>

      <Dialog
        size="sm"
        open={resetting()}
        onOpenChange={setResetting}
        title={t('prefs.about.reset-title')}
        description={t('prefs.about.reset-description')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetting(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              tone="danger"
              onClick={() => {
                resetConfig();
                setResetting(false);
              }}
            >
              {t('prefs.about.reset-action')}
            </Button>
          </>
        }
      />
    </>
  );
}
