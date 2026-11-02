import { Badge, Button, IconButton, Menu, MenuItem } from '@vesta/ui';
import { listen } from '@tauri-apps/api/event';
import { Show, createEffect, createSignal, untrack } from 'solid-js';
import { navigate } from '../../../app/router';
import { Icon } from '../../../components/icon';
import { Notice, noticeCause } from '../../../components/notice';
import { findInstance } from '../../../features/instances/catalog';
import { nativeInstances } from '../../../features/instances/native-service';
import { packUpdateTarget, useNativePack, versionStore, type LinkedPack as Pack } from '../../../features/instances/versions';
import { errorMessage } from '../../../features/servers/errors';
import { PACK_SYNC_CHANGED_EVENT, PACK_SYNC_STATUS_EVENT, type PackSyncCheck } from '../../../features/servers/native-pack-sync';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { ServerPlayers } from '../../browse/server-parts';
import { PackIdentity, packVersionLabel } from './pack-identity';
import { ServerUnlinkDialog, serverUpdateTarget, useModrinthServer } from './server-link';
import './versions-tab.css';

/**
 * Overview: the instance's linked pack, the same card for a provider modpack and a server
 * (only the source differs). Updates are reviewed on Versions, exactly as for any linked pack.
 * A server link also shows the server's signed status (required update, offline). A Modrinth
 * server listing reads like a server link too: its name and icon, the Server tag and its live
 * players; a vanilla listing has no pack, so the card stands for the link alone.
 */
export function LinkedPack(props: { instanceId: string }) {
  const id = untrack(() => props.instanceId);
  useNativePack(id);
  const store = untrack(() => versionStore(id));
  const pack = () => store.state().pack;
  const listing = useModrinthServer(id);
  const sync = useServerStatus(() => (pack()?.source === 'Server' ? id : undefined));
  const [unlinking, setUnlinking] = createSignal(false, { name: 'instance:server-unlinking' });
  const target = () => {
    const value = pack();
    if (!value) return undefined;
    return listing.identity() ? serverUpdateTarget(value, listing.status()) : packUpdateTarget(value);
  };
  const required = () => sync.status()?.status === 'update_required' || !!listing.status()?.updateRequired;
  const available = () =>
    !!target() || sync.status()?.status === 'update_available' || !!listing.status()?.updateAvailable;
  /** The card's subject: the pack, or for a vanilla listing the link itself. */
  const shown = (): Pack | undefined => {
    const value = pack();
    if (value) return value;
    const identity = listing.identity();
    return identity
      ? { name: identity.name, icon: findInstance(id)?.instance.image ?? '', source: 'Modrinth', installed: '', releases: [] }
      : undefined;
  };
  const fromServer = () => pack()?.source === 'Server' || !!listing.identity();
  return (
    <Show when={shown()}>
      {(linked) => (
        <section data-vesta="pack-view" data-overview="" aria-label={t('instance-pack.title')}>
          <header data-vesta="pack-head">
            <PackIdentity pack={linked()} listing={listing.identity()} meta={
              <>
                <span>
                  {pack()
                    ? packVersionLabel(linked())
                    : t('instance-pack.minecraft', { version: findInstance(id)?.instance.minecraftVersion ?? '' })}
                </span>
                <span>{t(fromServer() ? 'instance-pack.from-server' : 'instance-pack.from-provider')}</span>
                <Show when={listing.identity()}>
                  <ServerPlayers ping={listing.ping()} hook="pack-players" />
                </Show>
              </>
            } />
            <div data-vesta="pack-status">
              <Show when={sync.status()?.availability !== undefined && sync.status()!.availability !== 'online'}>
                <Badge size="sm" variant="soft" tone="warning">{t('server-pack.unavailable')}</Badge>
              </Show>
              <Show when={available()} fallback={
                <span data-vesta="pack-current"><Icon name="icons/controls/check" size={12} />{t('versions.up-to-date')}</span>
              }>
                <Button size="sm" tone={required() ? 'danger' : 'accent'} icon={<Icon name="icons/actions/download" size={14} />}
                  onClick={() => navigate(`/library/${id}/versions`, { replace: true })}>
                  {target() ? t('versions.update-to', { version: target()!.label }) : t(required() ? 'server-pack.update-required' : 'server-pack.update-available')}
                </Button>
              </Show>
              <Show when={listing.identity()}>
                <Menu
                  placement="bottom-end"
                  trigger={(menuProps) => (
                    <IconButton
                      {...menuProps}
                      size="sm"
                      variant="ghost"
                      label={t('instance-pack.server-actions')}
                      icon={<Icon name="icons/controls/ellipsis-horizontal" size={16} />}
                    />
                  )}
                >
                  <MenuItem icon={<Icon name="icons/content/link" size={14} />} onSelect={() => setUnlinking(true)}>
                    {t('instance-pack.unlink-server')}
                  </MenuItem>
                </Menu>
              </Show>
            </div>
          </header>
          <Show when={sync.error()}>{(reason) => <div data-vesta="version-warning"><Notice variant="inline" cause={noticeCause(reason())}>{t(errorMessage(reason()))}</Notice></div>}</Show>
          <Show when={listing.error()}>
            {(reason) => (
              <div data-vesta="version-warning">
                <Notice variant="inline" cause={noticeCause(reason())} details={String(reason())}
                  action={{ label: t('browse.retry'), onClick: () => listing.retry() }}>
                  {t('instance-pack.server-status-failed')}
                </Notice>
              </div>
            )}
          </Show>
          <ServerUnlinkDialog instanceId={id} name={listing.identity()?.name ?? ''} open={unlinking()} onClose={() => setUnlinking(false)} />
        </section>
      )}
    </Show>
  );
}

/** Native server-link status: demand reads plus native events. Native stays authoritative at launch. */
function useServerStatus(instanceId: () => string | undefined) {
  const [status, setStatus] = createSignal<PackSyncCheck | undefined>(undefined, { name: 'instance:pack-status' });
  const [error, setError] = createSignal<unknown>(undefined, { name: 'instance:pack-error' });
  createEffect(instanceId, (id) => {
    setStatus(undefined); setError(undefined);
    if (!id || !nativeInstances || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => (disposed ? stop() : stops.push(stop));
    const load = async () => {
      try {
        const check = await serverCommand((api) => api.packSyncCheck(Number(id)));
        if (!disposed) setStatus(check ?? undefined);
      } catch (reason) { if (!disposed) setError(reason); }
    };
    void load();
    void listen<PackSyncCheck>(PACK_SYNC_STATUS_EVENT, (event) => {
      if (!disposed && event.payload.instanceId === Number(id)) setStatus(event.payload);
    }).then(keep).catch((reason) => { if (!disposed) setError(reason); });
    void listen<number>(PACK_SYNC_CHANGED_EVENT, (event) => {
      if (!disposed && event.payload === Number(id)) void load();
    }).then(keep).catch((reason) => { if (!disposed) setError(reason); });
    return () => { disposed = true; for (const stop of stops) stop(); };
  }, { name: 'instance:pack-status-load' });
  return { status, error };
}
