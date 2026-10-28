import { Badge, Button, Checkbox, Select } from '@vesta/ui';
import { For, Show, createSignal, onCleanup, untrack } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { instances } from '../../../features/instances/catalog';
import { refreshNativeInstances } from '../../../features/instances/native-service';
import { syncApplyRequest, syncChangeSummary } from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import type { PackSyncPreview } from '../../../features/servers/native-pack-sync';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';

const NEW = 'new';
const uncertainCodes = new Set(['outcome_unknown', 'timeout', 'unreachable']);

/**
 * Get the modpack: a new local instance, or link an existing one. Native verifies the signed
 * release and builds a single-use review; executable changes need consent for that revision.
 */
export function GetModpack() {
  const area = useModpackArea();
  const [target, setTarget] = createSignal(NEW, { name: 'modpack-get:target' });
  const [review, setReview] = createSignal<PackSyncPreview | undefined>(undefined, { name: 'modpack-get:review' });
  const [consent, setConsent] = createSignal(false, { name: 'modpack-get:consent' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-get:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-get:error' });
  const [uncertain, setUncertain] = createSignal(false, { name: 'modpack-get:uncertain' });
  let disposed = false;
  void refreshNativeInstances();
  const published = () => (area.snapshot().pack?.hostedRevision ?? null) !== null || (area.workspace()?.publishedRevision ?? '0') !== '0';
  const candidates = () => instances().filter((entry) => /^\d+$/.test(entry.instance.id) && entry.state.kind !== 'running');

  const discard = () => {
    const old = untrack(review);
    setReview(undefined); setConsent(false);
    if (old) void serverCommand((api) => api.packSyncDiscard(old.reviewId)).catch(() => {});
  };
  onCleanup(() => { disposed = true; discard(); });

  const start = async () => {
    discard(); setBusy(true); setError(null);
    try {
      const value = await serverCommand((api) => api.packSyncPreview(area.id(), target() === NEW ? null : Number(target())));
      if (disposed) { void serverCommand((api) => api.packSyncDiscard(value.reviewId)).catch(() => {}); return; }
      setReview(value);
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { if (!disposed) setBusy(false); }
  };

  const apply = async (linkOnly: boolean) => {
    const value = review();
    if (!value) return;
    const request = syncApplyRequest(value, consent(), linkOnly);
    if (!request) return;
    // Reviews are single-use: drop it before applying, whatever the outcome.
    setReview(undefined); setConsent(false); setBusy(true); setError(null);
    try {
      const instance = await serverCommand((api) => api.packSyncApply(request));
      transitionTo(`/library/${instance}`);
    } catch (reason) {
      const failure = reason as ServerCommandError;
      setUncertain(uncertainCodes.has(failure.code));
      setError(failure);
    } finally { if (!disposed) setBusy(false); }
  };

  return (
    <section data-vesta="modpack-panel" data-panel="get">
      <header data-vesta="modpack-panel-head"><h3>{t('server-pack.get-title')}</h3></header>
      <div data-vesta="modpack-panel-body">
        <Show when={published()} fallback={<p data-vesta="server-muted">{t('server-pack.get-unpublished')}</p>}>
          <Show when={review()} fallback={
            <>
              <p data-vesta="server-muted">{t('server-pack.get-description')}</p>
              <Select size="sm" aria-label={t('server-pack.get-target')} value={target()} disabled={busy()} onChange={setTarget}
                options={[
                  { value: NEW, label: t('server-pack.get-new') },
                  ...candidates().map((entry) => ({ value: entry.instance.id, label: entry.instance.name, description: `${entry.instance.minecraftVersion} · ${entry.instance.modloader}` })),
                ]} />
              <Button size="sm" variant="outline" icon={<Icon name="icons/actions/download" />} disabled={busy() || uncertain()} onClick={() => void start()}>
                {t(target() === NEW ? 'server-pack.get-review-new' : 'server-pack.get-review-link')}
              </Button>
            </>
          }>
            {(value) => (
              <div data-vesta="modpack-sync-review">
                <p data-vesta="modpack-card-title">{value().name}</p>
                <p data-vesta="server-muted">
                  {value().runtime.minecraftVersion} · {value().runtime.loader} {value().runtime.loaderVersion ?? ''} · {t('server-pack.revision-facts', { published: value().revision, minimum: value().minimumRevision })}
                </p>
                <p>{t('server-pack.get-changes', syncChangeSummary(value().changes))}</p>
                <Show when={value().changes.length}>
                  <details data-vesta="modpack-unresolved">
                    <summary>{t('server-pack.get-show-changes')}</summary>
                    <ul>
                      <For each={value().changes}>
                        {(change) => (
                          <li><code>{change.path}</code> <Badge size="sm" variant="soft" tone={change.executable ? 'warning' : 'neutral'}>{change.operation}</Badge></li>
                        )}
                      </For>
                    </ul>
                  </details>
                </Show>
                <Show when={value().consentRequired}>
                  <Checkbox size="sm" checked={consent()} onChange={setConsent} disabled={busy()}
                    label={t('server-pack.get-consent', { version: value().revision })} description={t('server-pack.get-consent-help')} />
                </Show>
                <div data-vesta="modpack-card-actions">
                  <Button size="sm" variant="ghost" disabled={busy()} onClick={discard}>{t('common.cancel')}</Button>
                  <span data-vesta="server-toolbar-spacer" />
                  <Show when={value().instanceId !== null}>
                    <Button size="sm" variant="outline" disabled={busy()} onClick={() => void apply(true)}>{t('server-pack.get-link-only')}</Button>
                  </Show>
                  <Button size="sm" tone="accent" disabled={busy() || (value().consentRequired && !consent())} onClick={() => void apply(false)}>
                    {t(value().instanceId === null ? 'server-pack.get-install' : 'server-pack.get-update')}
                  </Button>
                </div>
              </div>
            )}
          </Show>
        </Show>
        <Show when={uncertain()}><p data-vesta="server-callout" data-tone="warning" role="alert">{t('server-pack.get-uncertain')}</p></Show>
        <ServerErrorNote error={error()} />
      </div>
    </section>
  );
}
