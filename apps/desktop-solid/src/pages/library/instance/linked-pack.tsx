import { Badge, Button } from '@vesta/ui';
import { listen } from '@tauri-apps/api/event';
import { Show, createEffect, createSignal, untrack } from 'solid-js';
import { navigate } from '../../../app/router';
import { Icon } from '../../../components/icon';
import { nativeInstances } from '../../../features/instances/native-service';
import { packUpdateTarget, useNativePack, versionStore } from '../../../features/instances/versions';
import { errorMessage } from '../../../features/servers/errors';
import { PACK_SYNC_CHANGED_EVENT, PACK_SYNC_STATUS_EVENT, type PackSyncCheck } from '../../../features/servers/native-pack-sync';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { PackIdentity, packVersionLabel } from './pack-identity';
import './versions-tab.css';

/**
 * Overview: the instance's linked pack, the same card for a provider modpack and a server
 * (only the source differs). Updates are reviewed on Versions, exactly as for any linked pack.
 * A server link also shows the server's signed status (required update, offline).
 */
export function LinkedPack(props: { instanceId: string }) {
  const id = untrack(() => props.instanceId);
  useNativePack(id);
  const store = versionStore(id);
  const pack = () => store.state().pack;
  const sync = useServerStatus(() => (pack()?.source === 'Server' ? id : undefined));
  const target = () => { const value = pack(); return value ? packUpdateTarget(value) : undefined; };
  const required = () => sync.status()?.status === 'update_required';
  const available = () => !!target() || sync.status()?.status === 'update_available';
  return (
    <Show when={pack()}>
      {(linked) => (
        <section data-vesta="pack-view" data-overview="" aria-label={t('instance-pack.title')}>
          <header data-vesta="pack-head">
            <PackIdentity pack={linked()} meta={
              <>
                {packVersionLabel(linked())}
                <span aria-hidden="true">·</span>
                {t(linked().source === 'Server' ? 'instance-pack.from-server' : 'instance-pack.from-provider')}
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
            </div>
          </header>
          <Show when={sync.error()}>{(reason) => <p role="alert" data-vesta="version-warning">{t(errorMessage(reason()))}</p>}</Show>
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
