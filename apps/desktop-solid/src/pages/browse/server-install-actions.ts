import { toast } from '@vesta/ui';
import { setNotice } from '../../features/browse/browse-store';
import type { ServerTarget } from '../../features/browse/install-targets';
import { installToServerTarget, type ServerSelection } from '../../features/browse/server-install';
import { t } from '../../localization';
import { closePicker } from './install-actions';

/** Installs into a server target chosen in the picker; the destination and dependencies are already settled. */
export async function installFromServerPicker(target: ServerTarget, selection: ServerSelection): Promise<void> {
  closePicker();
  const outcome = await installToServerTarget(target, selection);
  switch (outcome.kind) {
    case 'started':
      setNotice({
        tone: 'success',
        text: t('browse.server-install-started', { name: selection.project.name, title: target.name }),
      });
      break;
    case 'unavailable':
      toast.show({
        title: t('browse.server-install-coming-title'),
        description: t(
          outcome.reason === 'modpack-coming' ? 'browse.target-reason-modpack-coming' : 'browse.server-install-coming',
        ),
        tone: 'neutral',
      });
      break;
    default:
      setNotice({ tone: 'danger', text: t('browse.install-failed', { message: outcome.message }) });
  }
}
