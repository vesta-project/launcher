import { Badge, Button, Checkbox, Dialog, IconButton, Menu, MenuItem } from '@vesta/ui';
import { listen } from '@tauri-apps/api/event';
import { Show, createEffect, createSignal, untrack } from 'solid-js';
import { navigate } from '../../../app/router';
import { Icon } from '../../../components/icon';
import { Notice, noticeCause } from '../../../components/notice';
import { findInstance } from '../../../features/instances/catalog';
import { nativeInstances, refreshNativeInstances, reportInstanceError } from '../../../features/instances/native-service';
import { applyEngineVersion, packUpdateTarget, useNativePack, versionStore, type LinkedPack as Pack } from '../../../features/instances/versions';
import { errorMessage } from '../../../features/servers/errors';
import { PACK_SYNC_CHANGED_EVENT, PACK_SYNC_STATUS_EVENT, type PackSyncCheck, type PackSyncPreview } from '../../../features/servers/native-pack-sync';
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
  const store = untrack(() => versionStore(id));
  const pack = () => store.state().pack;
  const listing = useModrinthServer(id);
  const sync = useServerStatus(() => (pack()?.source === 'Server' && findInstance(id)?.state.kind !== 'installing' ? id : undefined));
  const [unlinking, setUnlinking] = createSignal(false, { name: 'instance:server-unlinking' });
  const target = () => {
    const value = pack();
    if (!value) return undefined;
    return listing.identity() ? serverUpdateTarget(value, listing.status()) : packUpdateTarget(value);
  };
  const required = () => sync.status()?.status === 'update_required' || !!listing.status()?.updateRequired;
  const available = () =>
    !!target() || sync.status()?.status === 'update_available' || !!listing.status()?.updateAvailable;
  const verifiedCurrent = () => !['installing', 'interrupted', 'failed'].includes(findInstance(id)?.state.kind ?? '')
    && (pack()?.source !== 'Server'
    || (sync.status()?.availability === 'online' && sync.status()?.status === 'current' && !sync.status()?.error && !sync.error()));
  /** The card's subject: the pack, or for a vanilla listing the link itself. */
  const shown = (): Pack | undefined => {
    const value = pack();
    if (value) return value;
    const identity = listing.identity();
    return identity
      ? { name: identity.name, icon: findInstance(id)?.instance.image ?? '', source: 'Modrinth', installed: '', releases: [] }
      : undefined;
  };
  const [review, setReview] = createSignal<PackSyncPreview>();
  const [consent, setConsent] = createSignal(false);
  const [updating, setUpdating] = createSignal(false);
  const apply = async (value: PackSyncPreview, trusted: boolean) => {
    setUpdating(true);
    try { await serverCommand(api => api.packSyncApply({ reviewId: value.reviewId, consentRevision: trusted ? value.revision : null })); setReview(undefined); await refreshNativeInstances(true); }
    catch (error) { reportInstanceError(error); }
    finally { setUpdating(false); }
  };
  const update = async () => {
    const value = pack(), next = target();
    if (!fromServer()) { navigate(`/library/${id}/versions`, { replace: true }); return; }
    if (!value || updating()) return;
    if (value.source !== 'Server') { if (next) await applyEngineVersion(id, next, next.id); return; }
    if (!value.serverId) return;
    setUpdating(true);
    try {
      const result = await serverCommand(api => api.packSyncPreview(value.serverId!, Number(id)));
      if (next && result.revision !== next.id) { await serverCommand(api => api.packSyncDiscard(result.reviewId)); throw new Error('The server pack changed. Check for updates again.'); }
      if (result.consentRequired) { setConsent(false); setReview(result); }
      else await apply(result, false);
    } catch (error) { reportInstanceError(error); }
    finally { setUpdating(false); }
  };
  const fromServer = () => pack()?.source === 'Server' || !!listing.identity();
  // An install that stopped partway is said once, by the header's Resume bar. Until it finishes,
  // the pack's own checks (release unverifiable, repair needed) only repeat that, so they wait.
  const unfinished = () => ['installing', 'interrupted', 'failed'].includes(findInstance(id)?.state.kind ?? '');
  return (
    <Show when={shown()}>
      {(linked) => (
        <section data-vesta="pack-view" data-overview="" aria-label={t('instance-pack.title')}>
          <header data-vesta="pack-head">
            <PackIdentity pack={linked()} listing={listing.identity()} meta={
              <>
                <span>
                  {pack() && linked().source !== 'Server'
                    ? packVersionLabel(linked())
                    : t('instance-pack.minecraft', { version: findInstance(id)?.instance.minecraftVersion ?? '' })}
                </span>
                <Show when={!fromServer()}><span>{t('instance-pack.from-provider')}</span></Show>
                <Show when={listing.identity()}>
                  <ServerPlayers ping={listing.ping()} hook="pack-players" />
                </Show>
              </>
            } />
            <div data-vesta="pack-status">
              <Show when={!unfinished() && sync.status()?.availability !== undefined && sync.status()!.availability !== 'online'}>
                <Badge size="sm" variant="soft" tone="warning" data-tip={t('server-pack.unavailable')}>{t('server-pack.unavailable-short')}</Badge>
              </Show>
              <Show when={!unfinished() && available()} fallback={
                <Show when={verifiedCurrent()}><span data-vesta="pack-current"><Icon name="icons/controls/check" size={12} />{t('versions.up-to-date')}</span></Show>
              }>
                <Button size="sm" tone={required() ? 'danger' : 'accent'} icon={<Icon name="icons/actions/download" size={14} />}
                  disabled={updating()} onClick={() => void update()}>
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
          <Show when={!unfinished() && (sync.error() ?? sync.status()?.error)}>{(reason) => <div data-vesta="version-warning"><Notice variant="inline" cause={noticeCause(reason())}>{t(errorMessage(reason()))}</Notice></div>}</Show>
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
          <Show when={review()}>{value => <Dialog open title={t('instance-pack.title')} closeLabel={t('nav.close')} onOpenChange={open => { if (!open && !updating()) { void serverCommand(api => api.packSyncDiscard(value().reviewId)); setReview(undefined); } }} footer={<Button disabled={updating() || !consent()} onClick={() => void apply(value(), consent())}>{t('versions.apply-change')}</Button>}><Checkbox label={t('server-pack.play-consent')} checked={consent()} onChange={setConsent} /></Dialog>}</Show>          <ServerUnlinkDialog instanceId={id} name={listing.identity()?.name ?? ''} open={unlinking()} onClose={() => setUnlinking(false)} />
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
        if (!disposed) { setStatus(check ?? undefined); setError(undefined); }
      } catch (reason) { if (!disposed) setError(reason); }
    };
    void load();
    void listen<PackSyncCheck>(PACK_SYNC_STATUS_EVENT, (event) => {
      if (!disposed && event.payload.instanceId === Number(id)) { setStatus(event.payload); setError(undefined); }
    }).then(keep).catch((reason) => { if (!disposed) setError(reason); });
    void listen<number>(PACK_SYNC_CHANGED_EVENT, (event) => {
      if (!disposed && event.payload === Number(id)) void load();
    }).then(keep).catch((reason) => { if (!disposed) setError(reason); });
    return () => { disposed = true; for (const stop of stops) stop(); };
  }, { name: 'instance:pack-status-load' });
  return { status, error };
}
