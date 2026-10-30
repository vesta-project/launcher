import { Button, IconButton, Switch as Toggle, TextField } from '@vesta/ui';
import { Show, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import { connectionFact, roleLabel } from '../../../features/servers/model';
import { updateServer, useServersClock } from '../../../features/servers/store';
import type { ServerSnapshot } from '../../../features/servers/native';
import { FingerprintView, Sensitive } from '../parts';
import { RemoveServerDialog } from '../remove-dialog';
import { ServerRefreshButton } from '../refresh-button';
import '../../library/instance/settings-tab.css';
import { Card as Panel } from '../../settings/parts';

/** Local connection settings: name, pin, how this device reaches and trusts the server, and removal. */
export function ConnectionTab(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const [name, setName] = createSignal(untrack(() => props.snapshot.connection.name), { name: 'server-connection:name' });
  const [removing, setRemoving] = createSignal(false, { name: 'server-connection:removing' });
  const [copied, setCopied] = createSignal(false, { name: 'server-connection:copied' });
  const id = () => props.snapshot.connection.id;
  const saveName = () => {
    const value = name().trim();
    if (value && value !== props.snapshot.connection.name) void updateServer(id(), { name: value });
    else setName(props.snapshot.connection.name);
  };
  const copyAddress = async () => {
    await navigator.clipboard?.writeText(props.snapshot.connection.endpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const signIn = () =>
    [props.snapshot.connection.signInMethod === 'minecraft' ? t('servers.sign-in.minecraft') : t('servers.sign-in.code'),
      props.snapshot.connection.role ? roleLabel(props.snapshot.connection.role) : null].filter(Boolean).join(', ');

  return (
    <div data-vesta="instance-settings-scroll" data-server-connection>
      <Panel title={t('servers.connection.general')}>
        <SettingRow label={t('servers.connection.name')} description={t('servers.connection.name-description')}>
          <TextField size="sm" aria-label={t('servers.connection.name')} value={name()} onChange={setName} onBlur={saveName}
            onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur(); }} />
        </SettingRow>
        <SettingRow label={t('servers.pin')} description={t('servers.connection.pin-description')}>
          <Toggle size="sm" aria-label={t('servers.pin')} checked={props.snapshot.connection.pinned} onChange={(pinned: boolean) => void updateServer(id(), { pinned })} />
        </SettingRow>
      </Panel>

      <Panel title={t('servers.connection.network')}>
        <SettingRow label={t('servers.address.label')} description={t('servers.connection.address-description')}>
          <span data-vesta="server-setting-value"><Sensitive>{props.snapshot.connection.endpoint}</Sensitive></span>
          <IconButton size="sm" variant="ghost" label={copied() ? t('servers.copied') : t('servers.copy-address')} icon={<Icon name={copied() ? 'icons/controls/check' : 'icons/actions/copy'} />} onClick={() => void copyAddress()} />
        </SettingRow>
        <SettingRow label={t('servers.connection.status')}>
          <span data-vesta="server-setting-value">{t(connectionFact(props.snapshot, now()).message, connectionFact(props.snapshot, now()).args)}</span>
          <ServerRefreshButton id={id()} />
        </SettingRow>
      </Panel>

      <Panel title={t('servers.connection.identity')}>
        <SettingRow label={t('servers.connection.sign-in')}>
          <span data-vesta="server-setting-value">{signIn()}</span>
        </SettingRow>
        <SettingRow label={t('servers.connection.storage')}>
          <span data-vesta="server-setting-value">
            {props.snapshot.connection.memoryOnly ? t('servers.connection.memory-only') : t('servers.connection.secure-storage')}
          </span>
        </SettingRow>
        <SettingRow label={t('servers.server-id')}>
          <code data-vesta="server-setting-value"><Sensitive label={t('servers.server-id')}>{props.snapshot.connection.serverId}</Sensitive></code>
        </SettingRow>
        <div data-vesta="server-setting-block">
          <div data-vesta="setting-row-copy">
            <span data-vesta="setting-row-label">{t('servers.fingerprint')}</span>
            <span data-vesta="setting-row-description">{t('servers.connection.fingerprint-help')}</span>
          </div>
          <FingerprintView value={props.snapshot.connection.fingerprint} />
        </div>
      </Panel>

      <Panel title={t('servers.connection.danger')} danger>
        <SettingRow label={t('servers.remove')} description={t('servers.connection.remove-description')}>
          <Button size="sm" tone="danger" variant="outline" onClick={() => setRemoving(true)}>{t('servers.remove')}</Button>
        </SettingRow>
      </Panel>
      <Show when={removing()}>
        <RemoveServerDialog snapshot={props.snapshot} open={removing()} onOpenChange={setRemoving} />
      </Show>
    </div>
  );
}
