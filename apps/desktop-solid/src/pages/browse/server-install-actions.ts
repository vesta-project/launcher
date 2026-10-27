import { toast } from '@vesta/ui';
import { setNotice } from '../../features/browse/browse-store';
import type { ServerTarget } from '../../features/browse/install-targets';
import { installToServerTarget, type ServerSelection } from '../../features/browse/server-install';
import { contentErrorMessage } from '../../features/servers/content-model';
import { t } from '../../localization';
import { closePicker } from './install-actions';

/** Installs into a server target chosen in the picker; the destination and dependencies are already settled. */
export async function installFromServerPicker(target: ServerTarget, selection: ServerSelection): Promise<void> {
  closePicker();
  const outcome = await installToServerTarget(target, selection);
  switch (outcome.kind) {
    case 'started':
      // While Minecraft runs the agent stages JAR changes; never promise a hot reload.
      toast.show({
        title: t(outcome.destination === 'modpack' ? 'browse.pack-draft-added-title' : outcome.destination === 'both' ? 'browse.server-pack-added-title' : outcome.staged ? 'browse.server-install-staged-title' : 'browse.server-install-done-title', {
          name: selection.project.name,
          title: target.name,
        }),
        description: outcome.staged ? t('browse.server-install-staged') : undefined,
        tone: outcome.staged ? 'neutral' : 'success',
      });
      break;
    case 'partial':
      toast.show({ title: t('browse.server-pack-partial-title'), description: t('browse.server-pack-partial-help'), tone: 'warning' });
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
      setNotice({
        tone: 'danger',
        text: t('browse.install-failed', {
          message: outcome.error ? t(contentErrorMessage(outcome.error)) : outcome.message,
        }),
      });
  }
}
