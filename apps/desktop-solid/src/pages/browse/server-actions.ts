import { createSignal, untrack } from 'solid-js';
import { transitionTo } from '../../app/transition';
import { hasDownloadableArtifact, projectKey, type ResourceProject } from '../../features/browse/browse-model';
import { setNotice } from '../../features/browse/browse-store';
import { installServerPack, linkInstanceToServer } from '../../features/browse/server-links';
import { playInstance } from '../../features/instances/catalog';
import { launchNativeInstance, nativeInstances } from '../../features/instances/native-service';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { closePicker } from './install-actions';
import { openInstallSource } from '../create/install-navigation';
import { serverPack } from '../../features/browse/server-listing';
import { loadProject, loadVersionDetails } from '../../features/browse/browse-projects';

/**
 * Joining a Modrinth server listing from its page: install its pack as a new linked instance,
 * link an existing instance from the picker, or play the linked one. Failures are kept for the
 * project page's Notice (with Retry); successes use the Browse notice bar like installs do.
 */

export interface ServerActionError {
  /** `platform:id` of the listing the failure belongs to. */
  key: string;
  message: MessageId;
  details: string;
  retry: () => void;
}

const [serverActionError, setServerActionError] = createSignal<ServerActionError | undefined>(undefined, {
  name: 'browseServerActionError',
});
const [serverBusy, setServerBusy] = createSignal<string | undefined>(undefined, { name: 'browseServerBusy' });
export { serverActionError, serverBusy };
export const clearServerActionError = () => setServerActionError(undefined);

const detailsOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

async function run(project: ResourceProject, message: MessageId, work: () => Promise<void>, retry: () => void) {
  const key = projectKey(project.source, project.id);
  if (untrack(serverBusy) === key) return;
  setServerBusy(key);
  setServerActionError(undefined);
  try {
    await work();
  } catch (reason) {
    setServerActionError({ key, message, details: detailsOf(reason), retry });
  } finally {
    setServerBusy(undefined);
  }
}

/**
 * Install & play. A modpack listing goes through the regular modpack install form (name, icon,
 * memory, release), pinned to the listing's pack version; Create links the new instance to the
 * listing once it exists. A vanilla listing has no pack to review, so the host creates and links
 * its instance at the recommended version in one step.
 */
export function joinWithNewInstance(project: ResourceProject): Promise<void> {
  closePicker();
  const pack = serverPack(project.server);
  if (pack) {
    clearServerActionError();
    openInstallSource(async () => {
      const [packProject, details] = await Promise.all([
        loadProject('modrinth', pack.projectId),
        loadVersionDetails('modrinth', pack.projectId, pack.versionId),
      ]);
      const release = details.version;
      const url = hasDownloadableArtifact(release) ? release.download_url || release.files?.[0]?.url : undefined;
      if (!url) throw new Error(t('install.release-unavailable'));
      return { kind: 'url', value: url, online: { project: packProject, release } };
    }, project);
    return Promise.resolve();
  }
  return run(
    project,
    'browse.server-install-failed',
    async () => {
      const id = await installServerPack(project);
      setNotice({ tone: 'success', text: t('browse.server-install-started', { name: project.name }) });
      transitionTo(`/library/${encodeURIComponent(id)}`);
    },
    () => void joinWithNewInstance(project),
  );
}

/** Links an instance chosen in the picker; Play with it joins the listing from then on. */
export function linkFromPicker(project: ResourceProject, instance: { id: string; name: string }): Promise<void> {
  closePicker();
  return run(
    project,
    'browse.server-link-failed',
    async () => {
      await linkInstanceToServer(instance.id, project);
      setNotice({ tone: 'success', text: t('browse.server-linked', { name: instance.name, title: project.name }) });
    },
    () => void linkFromPicker(project, instance),
  );
}

/** Play with the linked instance; the host launches it with the server as its target. */
export function playLinked(project: ResourceProject, instanceId: string): Promise<void> {
  return run(
    project,
    'browse.server-play-failed',
    async () => {
      if (!nativeInstances) {
        playInstance(instanceId);
        return;
      }
      // Never stops a running game (unlike the library's Play/Stop toggle); launch failures
      // surface through the instance error like any other launch.
      await launchNativeInstance(instanceId);
    },
    () => void playLinked(project, instanceId),
  );
}
