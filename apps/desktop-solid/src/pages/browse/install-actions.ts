import { open as openInShell } from '@tauri-apps/plugin-shell';
import { createSignal, untrack } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import { worldsFor } from '../../features/instances/details';
import type { NativeWorld } from '../../features/instances/native-details-model';
import { installResource } from '../../features/browse/browse-api';
import { loadVersions } from '../../features/browse/browse-projects';
import {
  hasDownloadableArtifact,
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
export function closePicker(): void { setPickerProject(undefined); }

/** Opens a provider page in the system browser (or a new tab in the preview). */
export async function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (nativeInstances) await openInShell(url);
  else window.open(url, '_blank', 'noopener');
}

const rank = { release: 0, beta: 1, alpha: 2 } as const;

/** The pack release handed to the create flow: the newest match for the filters, else the newest release. */
function packRelease(versions: readonly ResourceVersion[], minecraft: string | null, packLoader: string | null) {
  const filtered = packLoader ? versions.filter((version) => version.loaders.some((id) => id.toLowerCase() === packLoader)) : versions;
  const match = minecraft
    ? selectInstallVersion(filtered, { minecraftVersion: minecraft, modloader: packLoader || 'vanilla' }, 'modpack')
        ?.version
    : undefined;
  if (match) return match;
  return [...(!minecraft && filtered.length ? filtered : versions)].sort(
    (a, b) =>
      rank[a.release_type] - rank[b.release_type] ||
      String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')),
  )[0];
}

async function startPack(project: ResourceProject) {
  try {
    const versions = await loadVersions(project.source, project.id);
    const release = packRelease(versions, gameVersion(), loader());
    const url = release
      ? hasDownloadableArtifact(release)
        ? release.download_url || release.files?.[0]?.url
        : undefined
      : undefined;
    if (!release || !url) throw new Error(t('install.release-unavailable'));
    // Preserve provider identity and the exact release instead of re-inferring them from a CDN URL.
    openInstallSource({ kind: 'url', value: url, online: { project, release } });
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

/** The Install action dispatches to the target, picker, pack flow or World chooser. */
export async function runInstall(
  project: ResourceProject,
  kind: ResourceType,
  target: ({ id: string; name: string } & InstallTarget) | undefined,
) {
  if (kind === 'modpack') return startPack(project);
  if (!target) { setPickerProject(project); return; }
  if (kind === 'datapack') return chooseWorld(project, target);
  reportOutcome(project, target.name, await installInto(project, target, kind));
}

/** Installs into an instance chosen in the picker. */
export async function installFromPicker(
  project: ResourceProject,
  kind: ResourceType,
  instance: { id: string; name: string } & InstallTarget,
) {
  closePicker();
  if (kind === 'datapack') return chooseWorld(project, instance);
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

export type WorldOption = { id: string; name: string; icon?: string; detail?: string };
type WorldChoice = {
  project: ResourceProject;
  instance: { id: string; name: string };
  worlds?: WorldOption[];
  error?: string;
};
const [worldChoice, setWorldChoice] = createSignal<WorldChoice | undefined>(undefined, { name: 'browseWorldChoice' });
export { worldChoice };
let worldRequest = 0;
let worldTarget: ({ id: string; name: string } & InstallTarget) | undefined;
let worldVersions = new Map<string, string | undefined>();
let installingWorld = false;
export function closeWorldChoice(): void {
  worldRequest++;
  worldTarget = undefined;
  worldVersions = new Map();
  setWorldChoice(undefined);
}

async function chooseWorld(project: ResourceProject, instance: { id: string; name: string } & InstallTarget): Promise<void> {
  const request = ++worldRequest;
  worldTarget = instance;
  worldVersions = new Map();
  setWorldChoice({ project, instance: { id: instance.id, name: instance.name } });
  try {
    let worlds: WorldOption[];
    const versions = new Map<string, string | undefined>();
    if (nativeInstances) {
      const rows = await invoke<NativeWorld[]>('list_instance_worlds', { instanceId: Number(instance.id), forceRefresh: true });
      worlds = rows.filter((row) => !row.running).map((row) => {
        versions.set(row.ref.directoryName, row.gameVersion ?? undefined);
        return { id: row.ref.directoryName, name: row.displayName, icon: row.iconDataUrl ?? undefined, detail: row.gameVersion ?? undefined };
      });
    } else {
      worlds = worldsFor(instance.id).filter((world) => !world.running).map((world) => {
        versions.set(world.id, world.gameVersion);
        return { id: world.id, name: world.name, icon: world.image, detail: world.gameVersion };
      });
    }
    if (request !== worldRequest) return;
    worldVersions = versions;
    setWorldChoice({ project, instance: { id: instance.id, name: instance.name }, worlds });
  } catch (reason) {
    if (request !== worldRequest) return;
    setWorldChoice({ project, instance: { id: instance.id, name: instance.name }, error: t('browse.world-load-failed', { message: String(reason) }) });
  }
}

/** Only accept a world from the current choice, including its opaque directory identity. */
export async function installIntoWorld(world: WorldOption): Promise<void> {
  const choice = untrack(worldChoice);
  const target = worldTarget;
  if (installingWorld || !choice || !target || !choice.worlds?.some((option) => option.id === world.id)) return;
  const request = worldRequest;
  const game = worldVersions.get(world.id);
  installingWorld = true;
  try {
    const versions = await loadVersions(choice.project.source, choice.project.id);
    if (request !== worldRequest) return;
    const selected = selectInstallVersion(versions, { ...target, minecraftVersion: game || target.minecraftVersion }, 'datapack', choice.project.source);
    if (!selected) reportOutcome(choice.project, world.name, { kind: 'no-version' });
    else if (!hasDownloadableArtifact(selected.version)) reportOutcome(choice.project, world.name, { kind: 'external' });
    else {
      await installResource({ instanceId: target.id, project: choice.project, version: selected.version, type: 'datapack',
        world: { instanceId: Number(target.id), directoryName: world.id } });
      reportOutcome(choice.project, world.name, { kind: 'started' });
    }
  } catch (reason) {
    setNotice({ tone: 'danger', text: t('browse.install-failed', { message: String(reason) }) });
  } finally {
    installingWorld = false;
    if (request === worldRequest) closeWorldChoice();
  }
}
