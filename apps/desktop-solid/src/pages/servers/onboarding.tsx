import { Button } from '@vesta/ui';
import { transitionTo } from '../../app/transition';
import { Board } from '../../components/board';
import { Icon } from '../../components/icon';
import { VESTA_INSTALL_COMMAND } from '../../features/servers/onboarding-model';
import { t } from '../../localization';
import { CommandLine } from './vesta-parts';
import './vesta-server.css';

/**
 * Host a server: install Vesta Server on the machine that will run it with one command, then
 * set it up from here. Older links for hosting on this PC or elsewhere both land on this guide.
 */
export function HostGuide() {
  return (
    <Board class="servers-board">
      <div data-vesta="server-add">
        <div data-vesta="server-add-panel">
          <h1>{t('servers.host.title')}</h1>
          <p>{t('servers.host.intro')}</p>
          <ol data-vesta="server-host-steps">
            <li>
              <strong>{t('servers.host.install')}</strong>
              <span>{t('servers.host.install-help')}</span>
              <CommandLine command={VESTA_INSTALL_COMMAND} />
            </li>
            <li>
              <strong>{t('servers.host.set-up')}</strong>
              <span>{t('servers.host.set-up-help')}</span>
            </li>
          </ol>
          <footer>
            <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('common.back')}</Button>
            <Button tone="accent" icon={<Icon name="icons/content/server" />} onClick={() => transitionTo('/servers/setup')}>{t('vesta-server.setup.title')}</Button>
          </footer>
        </div>
      </div>
    </Board>
  );
}
