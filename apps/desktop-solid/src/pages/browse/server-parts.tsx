import { Show } from 'solid-js';
import { Icon } from '../../components/icon';
import { formatRelative, type ServerListing, type ServerPing } from '../../features/browse/browse-model';
import {
  freshnessDot,
  pingFreshness,
  regionFallback,
  regionMessage,
  serverGameVersions,
  serverPack,
  vanillaVersionText,
} from '../../features/browse/server-listing';
import { t } from '../../localization';
import { StatusDot } from '../servers/parts';

/** A listing region in words; unknown ids are shown as written. */
export function regionText(region: string | null | undefined): string {
  if (!region) return '';
  const id = regionMessage(region);
  return id ? t(id) : regionFallback(region);
}

/**
 * Players online / max behind the shared status dot: green for a recent ping, grey for an old
 * one (still the last known count), and "Offline" when Modrinth has none.
 */
export function ServerPlayers(props: { ping: ServerPing | null | undefined; hook?: string }) {
  const freshness = () => pingFreshness(props.ping, Date.now());
  const when = () => formatRelative(props.ping?.at, Date.now());
  return (
    <span
      data-vesta={props.hook ?? 'server-players'}
      data-freshness={freshness()}
      data-tip={
        props.ping
          ? t('browse.server-players-title', { count: props.ping.online, max: props.ping.max, when: when() })
          : t('browse.server-ping-none-title')
      }
    >
      <StatusDot dot={freshnessDot[freshness()]} />
      <Show when={props.ping} fallback={t('browse.server-ping-none')}>
        {(ping) => t('browse.server-players', { count: ping().online, max: ping().max })}
      </Show>
    </span>
  );
}

/** "Modpack: <name>" for a pack listing, else the vanilla version (recommended, or the range). */
export function ServerContentLabel(props: { listing: ServerListing; hook?: string }) {
  const pack = () => serverPack(props.listing);
  const versions = () => serverGameVersions(props.listing);
  return (
    <Show
      when={pack()}
      fallback={
        <Show when={vanillaVersionText(props.listing)}>
          {(version) => (
            <span
              data-vesta={props.hook ?? 'server-content'}
              data-tip={t('browse.server-vanilla-title', { version: versions().length > 1 ? versions().join(', ') : version() })}
            >
              <Icon name="icons/content/cube" size={11} />
              {version()}
            </span>
          )}
        </Show>
      }
    >
      {(content) => (
        <span data-vesta={props.hook ?? 'server-content'}>
          <Icon name="icons/content/modpack" size={11} />
          {t('browse.server-modpack', { name: content().projectName ?? '' })}
        </span>
      )}
    </Show>
  );
}

export function ServerRegion(props: { region: string | null | undefined; hook?: string }) {
  return (
    <Show when={regionText(props.region)}>
      {(text) => (
        <span data-vesta={props.hook ?? 'server-region'}>
          <Icon name="icons/content/globe" size={11} />
          {text()}
        </span>
      )}
    </Show>
  );
}
