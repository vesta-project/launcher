import { Button, Dialog, toast } from '@vesta/ui';
import { createSignal } from 'solid-js';
import { navigate, route } from '../../app/router';
import { t } from '../../localization';
import { findInstance, removeInstance } from './catalog';
import { instanceError, instancePending } from './native-service';

const [requestedId, setRequestedId] = createSignal<string>();
export const requestInstanceDelete = (id: string) => setRequestedId(id);

/** Lives outside the menu so closing it cannot dismiss the confirmation. */
export function InstanceDeleteDialog() {
  const [deleting, setDeleting] = createSignal(false);
  const entry = () => findInstance(requestedId());
  const locked = () => {
    const current = entry();
    return !current || deleting() || instancePending(current.instance.id) ||
      ['running', 'warming', 'installing'].includes(current.state.kind);
  };
  const close = () => { if (!deleting()) setRequestedId(undefined); };
  const confirm = async () => {
    const current = entry();
    if (!current || locked()) return;
    const id = current.instance.id;
    setDeleting(true);
    try {
      const removed = await removeInstance(id);
      if (removed === false) {
        toast.show({ title: t('management.error'), description: instanceError(), tone: 'danger' });
        return;
      }
      setRequestedId(undefined);
      if (route().page === 'library' && route().section === id) navigate('/library', { replace: true });
    } catch (error) {
      toast.show({ title: t('management.error'), description: String(error), tone: 'danger' });
    } finally {
      setDeleting(false);
    }
  };
  return <Dialog
    title={t('instance-settings.delete-title', { name: entry()?.instance.name ?? '' })}
    description={t('instance-settings.delete-confirm-description')}
    open={!!entry()}
    onOpenChange={(open) => { if (!open) close(); }}
    size="sm"
    footer={<>
      <Button variant="ghost" disabled={deleting()} onClick={close}>{t('common.cancel')}</Button>
      <Button tone="danger" disabled={locked()} onClick={() => void confirm()}>{t('common.delete')}</Button>
    </>}
  />;
}
