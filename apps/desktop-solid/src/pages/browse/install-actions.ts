import { open as openInShell } from '@tauri-apps/plugin-shell';
import { createSignal } from 'solid-js';
import { transitionTo } from '../../app/transition';
import { loadVersions } from '../../features/browse/browse-projects';
import {
  hasDownloadableArtifact,
  projectPath,
  selectInstallVersion,
  type InstallTarget,
  type ResourceProject,
  type ResourceType,
  type ResourceVersion,
} from '../../features/browse/browse-model';
import { gameVersion, installInto, loader, setNotice, type InstallOutcome } from '../../features/browse/browse-store';
import { installIntoNewInstance } from '../../features/browse/new-instance-install';
import { nativeInstances } from '../../features/instances/native-service';
import { t } from '../../localization';
import { openInstallSource } from '../create/install-navigation';

/** The project waiting for an instance choice; the picker dialog is open while this is set. */
const [pickerProject, setPickerProject] = createSignal<ResourceProject | undefined>(undefined, {
  name: 'browsePickerProject',
});
export { pickerProject };
export const closePicker = () => setPickerProject(undefined);

/** Opens a provider page in the system browser (or a new tab in the preview). */
export async function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (nativeInstances) await openInShell(url);
  else window.open(url, '_blank', 'noopener');
}

const rank = { release: 0, beta: 1, alpha: 2 } as const;

/** The pack release handed to the create flow: the newest match for the filters, else the newest release. */
function packRelease(versions: readonly ResourceVersion[], minecraft: string | null, packLoader: string | null) {
  const match = minecraft
    ? selectInstallVersion(versions, { minecraftVersion: minecraft, modloader: packLoader || 'vanilla' }, 'modpack')
        ?.version
    : undefined;
  if (match) return match;
  return [...versions].sort(
    (a, b) =>
      rank[a.release_type] - rank[b.release_type] ||
      String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')),
  )[0];
}

async function startPack(project: ResourceProject) {
  try {
    const versions = await loadVersions(project.source, project.id).catch(() => []);
    const release = packRelease(versions, gameVersion(), loader());
    const url = release
      ? hasDownloadableArtifact(release)
        ? release.download_url || release.files?.[0]?.url
        : undefined
      : undefined;
    // The create flow reads packs from a URL; without a downloadable archive hand it the project page.
    openInstallSource({ kind: 'url', value: url || project.web_url });
  } catch (reason) {
    setNotice({ tone: 'danger', text: t('browse.install-failed', { message: String(reason) }) });
  }
}

export function reportOutcome(project: ResourceProject, instanceName: string, outcome: InstallOutcome) {
  switch (outcome.kind) {
    case 'started':
      setNotice({ tone: 'success', text: t('browse.install-started', { name: project.name, title: instanceName }) });
      break;
    case 'no-version':
      setNotice({ tone: 'warning', text: t('browse.no-version', { name: project.name, title: instanceName }) });
      break;
    case 'external':
      setNotice({ tone: 'neutral', text: t('browse.external-download', { name: project.name }) });
      void openExternal(project.web_url);
      break;
    default:
      setNotice({ tone: 'danger', text: t('browse.install-failed', { message: outcome.message }) });
  }
}

/** The card's primary action, whatever the type: instance install, picker, create flow or details. */
export async function runInstall(
  project: ResourceProject,
  kind: ResourceType,
  target: ({ id: string; name: string } & InstallTarget) | undefined,
) {
  if (kind === 'modpack') return startPack(project);
  // Data packs need a world; choosing one happens on the project page.
  if (kind === 'datapack') return transitionTo(projectPath(project.source, project.id));
  if (!target) return setPickerProject(project);
  reportOutcome(project, target.name, await installInto(project, target, kind));
}

/** Installs into an instance chosen in the picker. */
export async function installFromPicker(
  project: ResourceProject,
  kind: ResourceType,
  instance: { id: string; name: string } & InstallTarget,
) {
  closePicker();
  reportOutcome(project, instance.name, await installInto(project, instance, kind));
}

/** The picker's footer action: a new instance made for this project, seeded from the filters. */
export function installIntoNew(project: ResourceProject, kind: ResourceType) {
  closePicker();
  return installIntoNewInstance(project, kind, {
    minecraftVersion: gameVersion() ?? undefined,
    loader: loader() ?? undefined,
  });
}
