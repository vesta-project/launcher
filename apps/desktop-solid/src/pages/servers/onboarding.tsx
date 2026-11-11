import { Button } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { transitionTo } from '../../app/transition';
import { Board } from '../../components/board';
import { EmptyState, type EmptyStateSuggestion } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { openExternal } from '../../features/links/external-links';
import { HOST_RELEASES_URL, LOCAL_HOST_ADDRESS, hostGuideSteps, type HostMode } from '../../features/servers/onboarding-model';
import { t } from '../../localization';
import { copyText } from '../../platform/clipboard';
import { AddServer } from './add-server';

/** The three ways to start, shared by the empty Servers page and /servers/add. */
export function serverStartChoices(): EmptyStateSuggestion[] {
  return [
    { icon: 'icons/content/server', label: t('servers.start.host'), description: t('servers.start.host-help'), onSelect: () => transitionTo('/servers/add/host') },
    { icon: 'icons/security/network', label: t('servers.start.connect'), description: t('servers.start.connect-help'), onSelect: () => transitionTo('/servers/add/connect') },
    { icon: 'icons/content/monitor', label: t('servers.start.remote'), description: t('servers.start.remote-help'), onSelect: () => transitionTo('/servers/add/remote') },
  ];
}

/** `/servers/add`: pick how to start, like the Library's first-instance choices. */
export function ServerStart() {
  return (
    <Board class="servers-board">
      <div data-vesta="server-start">
        <EmptyState icon="icons/rail/servers" title={t('servers.start.title')} description={t('servers.start.description')}
          suggestionsLabel={t('servers.start.label')} suggestions={serverStartChoices()} />
        <div data-vesta="server-start-back">
          <Button variant="ghost" icon={<Icon name="icons/navigation/arrow-back" />} onClick={() => transitionTo('/servers')}>{t('servers.done.all-servers')}</Button>
        </div>
      </div>
    </Board>
  );
}

/**
 * Host a server, on this computer or another one. Vesta Host is installed once with its signed
 * installer (the launcher never invents release pins); then the usual connect flow pairs with it
 * using the one-time setup code the host prints, with the address prefilled for this computer.
 */
export function HostGuide(props: { mode: HostMode }) {
  const [step, setStep] = createSignal<'install' | 'connect'>('install', { name: 'host-guide:step' });
  return (
    <Show when={step() === 'connect'} fallback={<HostInstall mode={props.mode} onNext={() => setStep('connect')} />}>
      <AddServer guide={{ mode: props.mode, onBack: () => setStep('install') }} />
    </Show>
  );
}

function HostInstall(props: { mode: HostMode; onNext: () => void }) {
  const [copied, setCopied] = createSignal(false, { name: 'host-guide:copied' });
  const copy = async () => {
    try { await copyText(t('servers.host.code-command')); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* Clipboard unavailable; the command stays visible. */ }
  };
  const local = () => props.mode === 'local';
  return (
    <Board class="servers-board">
      <div data-vesta="server-add">
        <nav data-vesta="server-add-steps" aria-label={t('servers.add-steps')}>
          <ol>
            <For each={hostGuideSteps}>
              {(label, index) => (
                <li data-state={index() === 0 ? 'current' : 'next'} aria-current={index() === 0 ? 'step' : undefined}><span>{index() + 1}</span>{t(label)}</li>
              )}
            </For>
          </ol>
        </nav>
        <div data-vesta="server-add-panel">
          <h1>{t(local() ? 'servers.host.title-local' : 'servers.host.title-remote')}</h1>
          <p>{t(local() ? 'servers.host.intro-local' : 'servers.host.intro-remote')}</p>
          <ol data-vesta="server-host-steps">
            <li>
              <strong>{t('servers.host.install')}</strong>
              <span>{t(local() ? 'servers.host.install-help-local' : 'servers.host.install-help-remote')}</span>
              <div>
                <Button size="sm" variant="outline" icon={<Icon name="icons/actions/external-link" />} onClick={() => void openExternal(HOST_RELEASES_URL)}>{t('servers.host.get')}</Button>
              </div>
            </li>
            <li>
              <strong>{t('servers.host.code')}</strong>
              <span>{t('servers.host.code-help')}</span>
              <div data-vesta="server-host-command">
                <code>{t('servers.host.code-command')}</code>
                <Button size="sm" variant="ghost" icon={<Icon name={copied() ? 'icons/controls/check' : 'icons/actions/copy'} />} onClick={() => void copy()}>{t(copied() ? 'servers.host.copied' : 'servers.host.copy')}</Button>
              </div>
            </li>
            <li>
              <strong>{t('servers.host.connect')}</strong>
              <span>{local() ? t('servers.host.connect-help-local', { address: LOCAL_HOST_ADDRESS }) : t('servers.host.connect-help-remote')}</span>
            </li>
          </ol>
          <Show when={!local()}><p data-vesta="server-callout" data-tone="neutral">{t('servers.host.remote-network')}</p></Show>
          <footer>
            <Button variant="ghost" onClick={() => transitionTo('/servers/add')}>{t('common.back')}</Button>
            <Button tone="accent" onClick={props.onNext}>{t('servers.host.ready')}</Button>
          </footer>
        </div>
      </div>
    </Board>
  );
}
