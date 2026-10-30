import { Button, Checkbox, Dialog, Progress, Select } from '@vesta/ui';
import { For, Show, createEffect, createSignal, onCleanup, onSettled, untrack } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { instances } from '../../../features/instances/catalog';
import { refreshNativeInstances } from '../../../features/instances/native-service';
import { modpackGates, syncApplyRequest, syncChangeSummary } from '../../../features/servers/modpack-area-model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { PackSyncPreview } from '../../../features/servers/native-pack-sync';
import { peekServerResource } from '../../../features/servers/resources';
import { packWorkspaceResource } from '../../../features/servers/server-resources';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import './modpack.css';
import { openServerInstall } from '../../create/install-navigation';

const uncertainCodes = new Set(['outcome_unknown', 'timeout', 'unreachable']);
export type GetModpackMode = 'new' | 'link';

/**
 * Whether players can get a client pack from this server, in any mode: a published custom pack,
 * or the server's own modpack offered to players.
 */
export function offersClientPack(snapshot: ServerSnapshot): boolean {
  if (snapshot.pack?.status === 'published' || (snapshot.pack?.hostedRevision ?? null) !== null) return true;
  const workspace = peekServerResource(snapshot.connection.id, packWorkspaceResource);
  return (workspace?.clientPack?.mode ?? 'none') !== 'none' || (workspace?.publishedRevision ?? '0') !== '0';
}

export const canGetModpack = (snapshot: ServerSnapshot) => modpackGates(snapshot.capabilities, snapshot.connection.role).download;

/** Server Overview: play on this server with a new instance, or link one you have. */
export function PlayOnServerCard(props: { snapshot: ServerSnapshot }) {
  const [mode, setMode] = createSignal<GetModpackMode | null>(null, { name: 'play-card:mode' });
  return (
    <article data-vesta="server-stat" data-server-panel="play">
      <h2>{t('server-pack.play-title')}</h2>
      <Show when={props.snapshot.pack?.hostedRevision}>{(revision) => <p data-vesta="server-muted">{t('server-pack.play-version', { version: revision() })}</p>}</Show>
      <div data-vesta="server-stat-actions">
        <Button size="sm" tone="accent" icon={<Icon name="icons/actions/add" />} onClick={() => openServerInstall(props.snapshot.connection.id)}>{t('server-pack.play-create')}</Button>
        <Button size="sm" variant="outline" icon={<Icon name="icons/content/link" />} onClick={() => setMode('link')}>{t('server-pack.play-link')}</Button>
      </div>
      <Show when={mode()} keyed>{(value) => <GetModpackDialog snapshot={props.snapshot} mode={value} onClose={() => setMode(null)} />}</Show>
    </article>
  );
}

/**
 * Get the modpack: a new local instance, or link an existing one. Native verifies the signed
 * release and builds a single-use review; executable changes need consent for that revision.
 */
export function GetModpackDialog(props: { snapshot: ServerSnapshot; mode: GetModpackMode; onClose: () => void }) {
  onSettled(() => { if (props.mode === 'new') { openServerInstall(props.snapshot.connection.id); props.onClose(); } });
  const id = () => props.snapshot.connection.id;
  const [target, setTarget] = createSignal<string | undefined>(undefined, { name: 'modpack-get:target' });
  const [review, setReview] = createSignal<PackSyncPreview | undefined>(undefined, { name: 'modpack-get:review' });
  const [consent, setConsent] = createSignal(false, { name: 'modpack-get:consent' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-get:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-get:error' });
  const [uncertain, setUncertain] = createSignal(false, { name: 'modpack-get:uncertain' });
  let disposed = false;
  let sequence = 0;
  void refreshNativeInstances();
  const candidates = () => instances().filter((entry) => /^\d+$/.test(entry.instance.id) && entry.state.kind !== 'running');

  const discard = () => {
    const old = untrack(review);
    setReview(undefined); setConsent(false);
    if (old) void serverCommand((api) => api.packSyncDiscard(old.reviewId)).catch(() => {});
  };
  onCleanup(() => { disposed = true; discard(); });

  const start = async (instance: number | null) => {
    const request = ++sequence;
    discard(); setBusy(true); setError(null);
    try {
      const value = await serverCommand((api) => api.packSyncPreview(id(), instance));
      if (disposed || request !== sequence) { void serverCommand((api) => api.packSyncDiscard(value.reviewId)).catch(() => {}); return; }
      setReview(value);
    } catch (reason) { if (!disposed && request === sequence) setError(reason as ServerCommandError); }
    finally { if (!disposed && request === sequence) setBusy(false); }
  };
  // New instances use Create; linking reviews the instance once it is picked.
  createEffect(() => (props.mode === 'new' ? null : target() ?? null), (key) => {
    if (key) void start(key === 'new' ? null : Number(key));
  }, { name: 'modpack-get:review-target' });

  const apply = async (linkOnly: boolean) => {
    const value = review();
    if (!value) return;
    const request = syncApplyRequest(value, consent(), linkOnly);
    if (!request) return;
    // Reviews are single-use: drop it before applying, whatever the outcome.
    setReview(undefined); setConsent(false); setBusy(true); setError(null);
    try {
      const instance = await serverCommand((api) => api.packSyncApply(request));
      props.onClose();
      transitionTo(`/library/${instance}`);
    } catch (reason) {
      const failure = reason as ServerCommandError;
      setUncertain(uncertainCodes.has(failure.code));
      setError(failure);
    } finally { if (!disposed) setBusy(false); }
  };
  const counts = () => { const value = review(); return value ? syncChangeSummary(value.changes) : null; };

  return (
    <Show when={props.mode === 'link'}><Dialog open onOpenChange={(open) => { if (!open && !busy()) props.onClose(); }} closeLabel={t('nav.close')} size="md"
      title={t(props.mode === 'new' ? 'server-pack.play-create-title' : 'server-pack.play-link-title', { title: props.snapshot.connection.name })}
      footer={<>
        <Button variant="ghost" disabled={busy() && !!review()} onClick={props.onClose}>{t('common.cancel')}</Button>
        <Show when={review()?.instanceId !== null && review()}>
          <Button variant="outline" disabled={busy()} onClick={() => void apply(true)}>{t('server-pack.get-link-only')}</Button>
        </Show>
        <Button tone="accent" disabled={busy() || !review() || uncertain() || (review()!.consentRequired && !consent())} onClick={() => void apply(false)}>
          {t(props.mode === 'new' ? 'server-pack.play-create' : 'server-pack.get-update')}
        </Button>
      </>}>
      <div data-vesta="pack-review">
        <Show when={props.mode === 'link'}>
          <Select size="sm" label={t('server-pack.play-instance')} value={target()} disabled={busy()} onChange={setTarget}
            placeholder={t(candidates().length ? 'server-pack.play-instance-pick' : 'server-pack.play-instance-none')}
            options={candidates().map((entry) => ({ value: entry.instance.id, label: entry.instance.name, description: entry.instance.minecraftVersion }))} />
        </Show>
        <Show when={busy() && !review()}><Progress size="sm" label={t('server-pack.play-checking')} /></Show>
        <Show when={review()}>
          {(value) => (
            <>
              <div data-vesta="pack-review-version">
                <span data-vesta="pack-review-version-static"><small>{t('server-pack.review-version')}</small><strong>{value().name} {value().revision}</strong></span>
                <span data-vesta="pack-review-version-meta">
                  <span>{value().runtime.minecraftVersion}</span>
                  <span>{value().runtime.loader} {value().runtime.loaderVersion ?? ''}</span>
                </span>
              </div>
              <Show when={value().changes.length} fallback={<span data-vesta="server-muted">{t('server-pack.review-nothing')}</span>}>
                <details data-vesta="pack-review-notes">
                  <summary>{t('server-pack.get-changes', counts()!)}</summary>
                  <ul><For each={value().changes}>{(change) => <li><code>{change.path}</code></li>}</For></ul>
                </details>
              </Show>
              <Show when={value().consentRequired}>
                <Checkbox size="sm" checked={consent()} onChange={setConsent} disabled={busy()} label={t('server-pack.play-consent')} />
              </Show>
            </>
          )}
        </Show>
        <Show when={uncertain()}><p data-vesta="server-callout" data-tone="warning" role="alert">{t('server-pack.get-uncertain')}</p></Show>
        <ServerErrorNote error={error()} onRetry={props.mode === 'new' ? () => void start(null) : undefined} />
      </div>
    </Dialog></Show>
  );
}
