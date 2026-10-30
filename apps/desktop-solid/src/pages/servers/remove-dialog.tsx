import { toast } from '@vesta/ui';
import { createEffect } from 'solid-js';
import { transitionTo } from '../../app/transition';
import { route } from '../../app/router';
import { t } from '../../localization';
import { hideServer, removeServer } from '../../features/servers/store';
import { errorMessage } from '../../features/servers/errors';
import type { ServerSnapshot } from '../../features/servers/native';

export function RemoveServerDialog(props: { snapshot: ServerSnapshot; open: boolean; onOpenChange: (open: boolean) => void }) {
  createEffect(() => props.open, open => {
    if (!open) return;
    const id = props.snapshot.connection.id, name = props.snapshot.connection.name;
    let rollback = () => {};
    toast.undo({ title: t('servers.connection.remove-title', { name }), undoLabel: 'Undo',
      apply: () => { rollback = hideServer(id); props.onOpenChange(false); if (route().section === id) transitionTo('/servers'); },
      rollback: () => rollback(), commit: () => removeServer(id),
      onError: reason => toast.show({ title: t(errorMessage(reason)), tone: 'danger' }) });
  });
  return null;
}
