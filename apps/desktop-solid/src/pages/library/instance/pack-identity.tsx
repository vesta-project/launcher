import type { JSX } from '@solidjs/web';
import { navigate } from '../../../app/router';
import { projectPath } from '../../../features/browse/browse-model';
import { prefetchProject } from '../../../features/browse/browse-projects';
import type { LinkedPack } from '../../../features/instances/versions';
import { serverSnapshot } from '../../../features/servers/store';
import { t } from '../../../localization';
import type { ListingIdentity } from './server-link';

/**
 * Where a linked pack lives: its provider project page, or for a server-sourced link the
 * server's Modpack area. Server links never browse a provider.
 */
export function packLinkPath(pack: LinkedPack): string | undefined {
  if (pack.source === 'Server') return pack.serverId ? `/servers/${encodeURIComponent(pack.serverId)}/pack` : undefined;
  return pack.projectId ? projectPath(pack.source === 'CurseForge' ? 'curseforge' : 'modrinth', pack.projectId) : undefined;
}

/** The source tag: the provider's name, or the server's name for a server-sourced link. */
export function packSourceLabel(pack: LinkedPack): string {
  if (pack.source !== 'Server') return pack.source;
  return serverSnapshot(pack.serverId)?.connection.name ?? t('instance-pack.source-server');
}

/** The installed version as people read it: server links name a revision. */
export const packVersionLabel = (pack: LinkedPack) =>
  pack.source === 'Server' ? t('instance-pack.revision', { revision: pack.installed }) : pack.installedLabel ?? pack.installed;

/**
 * A linked pack's identity: icon, name, source tag and a meta line. One component for provider
 * and server-sourced links, used on Overview and Versions, so both read the same. A pack that
 * follows a Modrinth server listing reads like a server link: the listing's name and icon, the
 * Server tag, and it opens the listing.
 */
export function PackIdentity(props: { pack: LinkedPack; meta: JSX.Element; listing?: ListingIdentity }) {
  const path = () => props.listing?.path ?? packLinkPath(props.pack);
  const warm = () => {
    if (props.listing) return;
    if (props.pack.source !== 'Server' && props.pack.projectId) prefetchProject(props.pack.source === 'CurseForge' ? 'curseforge' : 'modrinth', props.pack.projectId);
  };
  return (
    <a
      data-vesta="pack-identity"
      href={path() ? `#${path()}` : undefined}
      onPointerEnter={warm}
      onFocus={warm}
      onClick={(event) => {
        const next = path();
        if (!next || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(next);
      }}
    >
      <img data-vesta="pack-icon" src={props.listing?.icon || props.pack.icon} alt="" />
      <div data-vesta="pack-title">
        <span data-vesta="pack-name">
          <strong>{props.listing?.name ?? props.pack.name}</strong>
          <span data-vesta="source-tag" data-source={props.listing ? 'server' : props.pack.source.toLowerCase()}>
            {props.listing ? t('instance-pack.source-server') : packSourceLabel(props.pack)}
          </span>
        </span>
        <span data-vesta="pack-meta">{props.meta}</span>
      </div>
    </a>
  );
}
