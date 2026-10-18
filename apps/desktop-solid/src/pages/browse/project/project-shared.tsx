import { Badge } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { Icon } from '../../../components/icon';
import {
  displayLoaders,
  initialOf,
  loaderLabel,
  projectKey,
  selectInstallVersion,
  updateAvailable,
  versionFit,
  type ReleaseType,
  type ResourceProject,
  type ResourceType,
  type ResourceVersion,
} from '../../../features/browse/browse-model';
import { installed, installingVersion, installState, target, type InstallState } from '../../../features/browse/browse-store';
import { formatDate, t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';

/** One project's kind (Browse's type tabs are plural). */
export const kindLabels: Record<ResourceType, MessageId> = {
  mod: 'browse.kind-mod',
  modpack: 'browse.kind-modpack',
  resourcepack: 'browse.kind-resourcepack',
  shader: 'browse.kind-shader',
  datapack: 'browse.kind-datapack',
  world: 'browse.kind-world',
};

/** Loaders with a bundled mark; the rest are shown by name. */
const loaderMarks = new Set(['fabric', 'forge', 'neoforge', 'quilt']);

export const loaded = (event: Event & { currentTarget: HTMLImageElement }) =>
  (event.currentTarget.dataset.loaded = '');
export const failed = (event: Event & { currentTarget: HTMLImageElement }) => (event.currentTarget.hidden = true);

/** A stable hue per project for art that has no image (matches the Browse cards). */
export function hueOf(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return Math.abs(hash) % 360;
}

export const formatDay = (value: string | null | undefined) => {
  if (!value) return '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? formatDate(time, { dateStyle: 'medium' }) : '';
};

/** The project's icon with its initial underneath, so a missing image still reads as a tile. */
export function ProjectIcon(props: { project: Pick<ResourceProject, 'name' | 'icon_url'>; hook?: string }) {
  return (
    <span data-vesta={props.hook ?? 'project-icon'} aria-hidden="true">
      <span data-vesta="project-icon-initial">{initialOf(props.project.name)}</span>
      <Show when={props.project.icon_url}>
        {(url) => <img src={url()} alt="" loading="lazy" decoding="async" onLoad={loaded} onError={failed} />}
      </Show>
    </span>
  );
}

/** Beta and alpha builds say so; releases are the norm and carry no badge. */
const channelTone = { release: 'success', beta: 'warning', alpha: 'danger' } as const;
export function ChannelBadge(props: { channel: ReleaseType }) {
  return (
    <Show when={props.channel !== 'release'}>
      <Badge size="sm" tone={channelTone[props.channel]} variant="soft">
        {t(`linking.channel-${props.channel}`)}
      </Badge>
    </Show>
  );
}

/**
 * A version's loaders in a fixed-width cell: the first by mark and name, the rest folded into
 * "+N" whose tooltip names them, so the column reads at a glance and never grows.
 */
export function LoaderMarks(props: { loaders: readonly string[] }) {
  const list = () => displayLoaders(props.loaders);
  return (
    <Show when={list()[0]}>
      {(first) => (
        <span data-vesta="project-loaders">
          <Show when={loaderMarks.has(first())}>
            <span data-vesta="project-loader-mark">
              <Icon name={`branding/modloaders/${first()}-logo`} size={14} />
            </span>
          </Show>
          <span data-vesta="project-loader-name" data-tip-overflow="">
            {loaderLabel(first())}
          </span>
          <Show when={list().length > 1}>
            <span data-vesta="project-loader-more" data-tip={list().slice(1).map(loaderLabel).join(', ')}>
              {t('browse.more-tags', { count: list().length - 1 })}
            </span>
          </Show>
        </span>
      )}
    </Show>
  );
}

/** Every loader as a small wrapping chip (mark and name), for panels with room to wrap. */
export function LoaderChips(props: { loaders: readonly string[]; 'aria-label'?: string }) {
  return (
    <ul data-vesta="project-loader-chips" aria-label={props['aria-label']}>
      <For each={displayLoaders(props.loaders)}>
        {(loader) => (
          <li data-vesta="project-loader-chip">
            <Show when={loaderMarks.has(loader)}>
              <Icon name={`branding/modloaders/${loader}-logo`} size={12} />
            </Show>
            <span data-vesta="project-loader-chip-label">{loaderLabel(loader)}</span>
          </li>
        )}
      </For>
    </ul>
  );
}

/**
 * The header's Install state: the card rule (target, installed, compatibility), refined with
 * the version list, which the page has and cards do not: updates and "no version fits".
 */
export function projectInstallState(project: ResourceProject, versions: readonly ResourceVersion[] | undefined): InstallState {
  const base = installState(project);
  const info = target();
  const kind = project.resource_type;
  if (!info || !versions || kind === 'modpack') return base;
  const choice = selectInstallVersion(versions, info, kind, project.source);
  if (base.kind === 'installed' && kind !== 'datapack')
    return updateAvailable(installed().get(projectKey(project.source, project.id)), choice) ? { kind: 'update' } : base;
  if (base.kind === 'install' && !choice) return { kind: 'unavailable', reason: 'no-version' };
  return base;
}

export interface VersionAction {
  state: InstallState;
  /** Another version of the project is installed in the target and would be replaced. */
  replaces: boolean;
  /** Another version of this project is installing; this one has to wait. */
  waiting: boolean;
}

/** Install state of one exact version against the target instance. */
export function versionAction(project: ResourceProject, version: ResourceVersion): VersionAction {
  const info = target();
  const kind = project.resource_type;
  const none = { replaces: false, waiting: false };
  if (!info || kind === 'modpack') return { state: { kind: 'install' }, ...none };
  const busy = installingVersion(project);
  if (busy === version.id) return { state: { kind: 'installing' }, ...none };
  const row = installed().get(projectKey(project.source, project.id));
  if (row?.remote_version_id === version.id) return { state: { kind: 'installed' }, ...none };
  const fit = versionFit(version, info, kind, project.source);
  if (fit.kind !== 'fits') return { state: { kind: 'unavailable', reason: fit.kind }, ...none };
  return { state: { kind: 'install' }, replaces: !!row, waiting: !!busy };
}

export const sameAction = (a: VersionAction, b: VersionAction) =>
  a.replaces === b.replaces &&
  a.waiting === b.waiting &&
  a.state.kind === b.state.kind &&
  (a.state.kind !== 'unavailable' || (b.state.kind === 'unavailable' && a.state.reason === b.state.reason));
