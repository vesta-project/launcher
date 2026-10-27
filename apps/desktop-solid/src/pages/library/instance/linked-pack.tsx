import { Button } from '@vesta/ui';
import { listen } from '@tauri-apps/api/event';
import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { nativeInstances } from '../../../features/instances/native-service';
import { errorMessage } from '../../../features/servers/errors';
import { PACK_SYNC_CHANGED_EVENT, PACK_SYNC_STATUS_EVENT, type PackSyncCheck, type PackSyncLink } from '../../../features/servers/native-pack-sync';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';

/** Demand reads and native events only. Native remains authoritative at launch. */
export function LinkedPack(props: { instanceId: string }) {
  const [link, setLink] = createSignal<PackSyncLink | undefined>(undefined, { name: 'instance:pack-link' });
  const [status, setStatus] = createSignal<PackSyncCheck | undefined>(undefined, { name: 'instance:pack-status' });
  const [error, setError] = createSignal<unknown>(undefined, { name: 'instance:pack-error' });
  const [busy, setBusy] = createSignal(false);
  let refresh = () => {};
  createEffect(() => props.instanceId, id => {
    if (!nativeInstances || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) return;
    let disposed = false;
    let active = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => disposed ? stop() : stops.push(stop);
    const load = async () => {
      if (active || disposed) return;
      active = true; setBusy(true); setError(undefined);
      try {
        const value = await serverCommand(api => api.packSyncLink(Number(id)));
        if (disposed) return;
        setLink(value ?? undefined);
        const check = value ? await serverCommand(api => api.packSyncCheck(Number(id))) : null;
        if (!disposed) setStatus(check ?? undefined);
      } catch (reason) { if (!disposed) setError(reason); }
      finally { active = false; if (!disposed) setBusy(false); }
    };
    refresh = () => { void load(); };
    setLink(undefined); setStatus(undefined); refresh();
    void listen<PackSyncCheck>(PACK_SYNC_STATUS_EVENT, event => {
      if (!disposed && event.payload.instanceId === Number(id)) setStatus(event.payload);
    }).then(keep).catch(reason => { if (!disposed) setError(reason); });
    void listen<number>(PACK_SYNC_CHANGED_EVENT, event => {
      if (!disposed && event.payload === Number(id)) void load();
    }).then(keep).catch(reason => { if (!disposed) setError(reason); });
    onCleanup(() => { disposed = true; for (const stop of stops) stop(); });
  });
  return <Show when={link()}>{value => <section data-vesta="overview-panel">
    <h3>{t('server-pack.title')}</h3>
    <Show when={status()}>{check => <>
      <p>{t('server-pack.installed')} {check().installedRevision ?? '?'} · {t('server-pack.release')} {check().publishedRevision} / {check().minimumRevision}</p>
      <p>{t(check().availability !== 'online' ? 'server-pack.unavailable' : check().status === 'update_required' ? 'server-pack.update-required' : check().status === 'update_available' ? 'server-pack.update-available' : 'server-pack.current')}</p>
      <Show when={check().error}><p role="alert">{t(errorMessage(check().error))}</p></Show>
    </>}</Show>
    <Show when={error()}><p role="alert">{t(errorMessage(error()))}</p></Show>
    <Button disabled={busy()} onClick={() => refresh()}>{t('server-pack.reload')}</Button>
    <Button onClick={() => transitionTo(`/servers/${encodeURIComponent(value().connectionId)}/pack`)}>{t('server-pack.review-install')}</Button>
  </section>}</Show>;
}
