import { Button, Dialog, Switch as Toggle, TextField } from '@vesta/ui';
import { Show, createSignal, untrack } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { t } from '../../../localization';
import { connectionFact, roleLabel } from '../../../features/servers/model';
import { removeServer, updateServer, useServersClock } from '../../../features/servers/store';
import type { ServerSnapshot } from '../../../features/servers/native';
import { SettingRow } from '../../../components/setting-row';
import { FingerprintView } from '../parts';

/** Local connection settings: label, pin, trust details, this device, remove. */
export function ConnectionTab(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const [name, setName] = createSignal(untrack(() => props.snapshot.connection.name));
  const [confirmRemove, setConfirmRemove] = createSignal(false);
  const id = () => props.snapshot.connection.id;
  const saveName = () => {
    const value = name().trim();
    if (value && value !== props.snapshot.connection.name) void updateServer(id(), { name: value });
  };
  return (
    <div data-vesta="server-connection">
      <SettingRow label={t('servers.connection.name')} description={t('servers.connection.name-description')}>
        <TextField aria-label={t('servers.connection.name')} value={name()} onChange={setName} onBlur={saveName} />
      </SettingRow>
      <SettingRow label={t('servers.pin')} description={t('servers.connection.pin-description')}>
        <Toggle aria-label={t('servers.pin')} checked={props.snapshot.connection.pinned} onChange={(pinned: boolean) => void updateServer(id(), { pinned })} />
      </SettingRow>

      <dl data-vesta="server-add-facts">
        <dt>{t('servers.address.label')}</dt><dd>{props.snapshot.connection.endpoint}</dd>
        <dt>{t('servers.connection.status')}</dt><dd>{t(connectionFact(props.snapshot, now()).message, connectionFact(props.snapshot, now()).args)}</dd>
        <dt>{t('servers.server-id')}</dt><dd><code>{props.snapshot.connection.serverId}</code></dd>
        <dt>{t('servers.connection.sign-in')}</dt>
        <dd>
          {props.snapshot.connection.signInMethod === 'minecraft' ? t('servers.sign-in.minecraft') : t('servers.sign-in.code')}
          <Show when={props.snapshot.connection.role}> · {roleLabel(props.snapshot.connection.role!)}</Show>
        </dd>
        <dt>{t('servers.connection.storage')}</dt>
        <dd>{props.snapshot.connection.memoryOnly ? t('servers.connection.memory-only') : t('servers.connection.secure-storage')}</dd>
      </dl>
      <h3>{t('servers.fingerprint')}</h3>
      <FingerprintView value={props.snapshot.connection.fingerprint} />
      <p data-vesta="server-muted">{t('servers.connection.fingerprint-help')}</p>

      <div data-vesta="server-danger-zone">
        <div>
          <strong>{t('servers.remove')}</strong>
          <p data-vesta="server-muted">{t('servers.connection.remove-description')}</p>
        </div>
        <Button tone="danger" variant="outline" onClick={() => setConfirmRemove(true)}>{t('servers.remove')}</Button>
      </div>
      <Dialog
        open={confirmRemove()}
        onOpenChange={setConfirmRemove}
        title={t('servers.connection.remove-title', { name: props.snapshot.connection.name })}
        description={t('servers.connection.remove-description')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>{t('common.cancel')}</Button>
            <Button tone="danger" onClick={() => void removeServer(id()).then(() => transitionTo('/servers'))}>{t('servers.remove')}</Button>
          </>
        }
      />
    </div>
  );
}
