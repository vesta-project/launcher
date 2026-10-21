import { Button, Dialog } from '@vesta/ui';
import { createSignal } from 'solid-js';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { route } from '../../app/router';
import { removeServer } from '../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../features/servers/native';
import { ServerErrorNote } from './parts';

/** Confirms forgetting a server on this device. The server itself is not changed. */
export function RemoveServerDialog(props: { snapshot: ServerSnapshot; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = createSignal(false, { name: 'server-remove:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-remove:error' });
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = props.snapshot.connection.id;
      await removeServer(id);
      props.onOpenChange(false);
      if (route().page === 'servers' && route().section === id) transitionTo('/servers');
    } catch (reason) {
      setError(reason as ServerCommandError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('servers.connection.remove-title', { name: props.snapshot.connection.name })}
      description={t('servers.connection.remove-description')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button tone="danger" disabled={busy()} onClick={() => void remove()}>{t('servers.remove')}</Button>
        </>
      }
    >
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}
