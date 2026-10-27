import { Button } from '@vesta/ui';
import { For, Show, createSignal, onCleanup, createEffect } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { browseForServer } from '../../../features/browse/browse-store';
import { refreshNativeInstances } from '../../../features/instances/native-service';
import { instances } from '../../../features/instances/catalog';
import { loadMetadata, loaderVersions } from '../../../features/instances/metadata';
import { gate } from '../../../features/servers/capabilities';
import { newIntentId } from '../../../features/servers/model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { PackManifest, PackPreview, PackWorkspace, PackLoader, PackSuggestions } from '../../../features/servers/native-pack';
import type { PackSyncPreview } from '../../../features/servers/native-pack-sync';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { publishRequest, syncRequest } from './model';
import './pack.css';

export function ClientPackTab(props: { snapshot: ServerSnapshot }) {
  const id = () => props.snapshot.connection.id;
  const can = (cap: string) => gate(props.snapshot.capabilities, cap) === 'allowed';
  const [workspace, setWorkspace] = createSignal<PackWorkspace | undefined>(undefined, { name: 'client-pack:workspace' });
  const [manifest, setManifest] = createSignal<PackManifest | undefined>(undefined, { name: 'client-pack:manifest' });
  const [review, setReview] = createSignal<PackPreview | undefined>(undefined, { name: 'client-pack:review' });
  const [suggestions, setSuggestions] = createSignal<PackSuggestions | undefined>(undefined, { name: 'client-pack:suggestions' });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'client-pack:error' });
  const [required, setRequired] = createSignal(false);
  const [ack, setAck] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [sync, setSync] = createSignal<PackSyncPreview | undefined>(undefined, { name: 'client-pack:sync-review' });
  const [target, setTarget] = createSignal('');
  const [consent, setConsent] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  let disposed = false;
  const intents = new Map<string, string>();
  const intent = (key: string) => { if (!intents.has(key)) intents.set(key, newIntentId()); return intents.get(key)!; };
  const run = async (action: () => Promise<void>) => {
    if (busy()) return;
    setBusy(true); setError(null);
    try { await action(); } catch (reason) { setError(reason as ServerCommandError); } finally { if (!disposed) setBusy(false); }
  };
  const load = async () => {
    if (!can('pack.edit')) return;
    const value = await serverCommand(api => api.packDraft(id()));
    if (disposed) return;
    setWorkspace(value); setManifest(structuredClone(value.draft.manifest)); setReview(undefined); setDirty(false); setAck(false);
  };
  const edit = (patch: Partial<PackManifest>) => { setManifest(value => value ? { ...value, ...patch } : value); setDirty(true); setReview(undefined); setAck(false); };
  const save = async () => {
    const value = manifest(); const state = workspace(); if (!value || !state) return;
    const request = { expectedRevision: state.draft.revision, manifest: value };
    await serverCommand(api => api.packWrite(id(), request, intent(JSON.stringify(request)))); await load();
  };
  const discard = () => { const old = sync(); setSync(undefined); setConsent(false); if (old) void serverCommand(api => api.packSyncDiscard(old.reviewId)).catch(() => {}); };
  createEffect(() => id(), () => { void run(load); void loadMetadata(); void refreshNativeInstances(); });
  onCleanup(() => { disposed = true; discard(); });
  const reviewSync = async () => {
    discard(); const value = await serverCommand(api => api.packSyncPreview(id(), target() ? Number(target()) : null));
    if (disposed) { await serverCommand(api => api.packSyncDiscard(value.reviewId)); return; }
    setSync(value);
  };
  const applySync = async (linkOnly: boolean) => {
    const value = sync(); if (!value) return;
    const request = syncRequest(value, consent(), linkOnly);
    setSync(undefined); setConsent(false);
    try { const instance = await serverCommand(api => api.packSyncApply(request)); transitionTo(`/library/${instance}`); }
    catch (reason) { const code = (reason as ServerCommandError).code; setUncertain(code === 'outcome_unknown' || code === 'timeout' || code === 'unreachable'); throw reason; }
  };
  return <section class="client-pack-workspace" aria-busy={busy() ? 'true' : 'false'}>
    <header><h2>{t('server-pack.title')}</h2><p>{t('server-pack.description')}</p></header>
    <ServerErrorNote error={error()} />
    <Show when={can('pack.edit')}>
      <Button disabled={busy()} onClick={() => void run(load)}>{t('server-pack.reload')}</Button>
      <Show when={workspace() && manifest()}><>
        <p>{t('server-pack.revisions')} {workspace()!.draft.revision} / {workspace()!.publishedRevision} / {workspace()!.minimumRevision}</p>
        <Show when={workspace()!.pendingPublication}><p role="status">{t('server-pack.pending')}</p></Show>
        <label>{t('server-pack.name')}<input value={manifest()!.name} disabled={busy()} onInput={e => edit({ name: e.currentTarget.value })} /></label>
        <label>{t('server-pack.summary')}<textarea value={manifest()!.summary} disabled={busy()} onInput={e => edit({ summary: e.currentTarget.value })} /></label>
        <label>{t('server-pack.version')}<input value={manifest()!.displayVersion} disabled={busy()} onInput={e => edit({ displayVersion: e.currentTarget.value })} /></label>
        <p>Minecraft {workspace()!.serverMinecraftVersion}</p>
        <Show when={workspace()!.minecraftDrift}><Button disabled={busy()} onClick={() => edit({ minecraftVersion: workspace()!.serverMinecraftVersion })}>{t('server-pack.repair')}</Button></Show>
        <label>{t('server-pack.loader')}<select value={manifest()!.loader} disabled={busy()} onChange={e => edit({ loader: e.currentTarget.value as PackLoader, loaderVersion: null })}><For each={['none', 'fabric', 'quilt', 'forge', 'neoforge']}>{value => <option value={value}>{value}</option>}</For></select></label>
        <Show when={manifest()!.loader !== 'none'}><label>{t('server-pack.loader-version')}<input list="pack-loader-versions" value={manifest()!.loaderVersion ?? ''} disabled={busy()} onInput={e => edit({ loaderVersion: e.currentTarget.value || null })} /><datalist id="pack-loader-versions"><For each={loaderVersions(workspace()!.serverMinecraftVersion, manifest()!.loader)}>{value => <option value={value} />}</For></datalist></label></Show>
        <h3>{t('server-pack.entries')}</h3>
        <For each={manifest()!.entries}>{entry => <div class="client-pack-entry"><code>{entry.path}</code><span>{entry.source.type}</span><label><input type="checkbox" checked={entry.required} disabled={busy()} onChange={e => edit({ entries: manifest()!.entries.map(item => item.id === entry.id ? { ...item, required: e.currentTarget.checked } : item) })} />{t('server-pack.required')}</label><Button disabled={busy()} onClick={() => edit({ entries: manifest()!.entries.filter(item => item.id !== entry.id) })}>{t('server-pack.remove')}</Button></div>}</For>
        <footer><Button disabled={busy() || dirty()} onClick={() => browseForServer({ id: id(), name: manifest()!.name, type: 'mod', minecraftVersion: workspace()!.serverMinecraftVersion, loader: manifest()!.loader === 'none' ? null : manifest()!.loader })}>{t('server-pack.browse')}</Button><Show when={dirty()}><Button disabled={busy()} onClick={() => void run(save)}>{t('server-pack.save')}</Button></Show><Button disabled={busy() || dirty()} onClick={() => void run(async () => { setSuggestions(await serverCommand(api => api.packSuggestions(id()))); })}>{t('server-pack.suggestions')}</Button><Button disabled={busy() || dirty() || !can('pack.build') || !can('pack.publish')} onClick={() => void run(async () => { setAck(false); setReview(await serverCommand(api => api.packPreview(id(), workspace()!.draft.revision))); })}>{t('server-pack.review')}</Button></footer>
        <Show when={suggestions()}>{value => <div><For each={value().items}>{item => <p>{item.kind}: {item.path ?? item.entryId ?? ''}</p>}</For><For each={value().warnings}>{warning => <p>{warning}</p>}</For></div>}</Show>
        <Show when={review()}>{value => <section><h3>{t('server-pack.review')}</h3><p>{t('server-pack.snapshot')}</p><p>{t('server-pack.metadata')} {String(value().diff.metadataChanged)}</p><For each={value().diff.added}>{entry => <p>+ {entry.path}</p>}</For><For each={value().diff.removed}>{entry => <p>- {entry.path}</p>}</For><For each={value().diff.changed}>{entry => <p>? {entry.after.path}</p>}</For><For each={value().diff.customOverrides}>{path => <p>{path}</p>}</For><For each={value().diff.symbolicLinks}>{path => <p role="alert">{path}</p>}</For><For each={value().issues}>{issue => <p role={issue.severity === 'error' ? 'alert' : undefined}>{issue.severity}: {issue.code} {issue.entryId}</p>}</For><For each={value().warnings}>{warning => <p>{warning}</p>}</For><label><input type="checkbox" checked={required()} disabled={busy() || !can('pack.force_update')} onChange={e => setRequired(e.currentTarget.checked)} />{t('server-pack.force')}</label><Show when={value().issues.some(issue => issue.code === 'display_version_lower')}><label><input type="checkbox" checked={ack()} onChange={e => setAck(e.currentTarget.checked)} />{t('server-pack.ack')}</label></Show><Button disabled={busy() || !value().valid || (value().issues.some(issue => issue.code === 'display_version_lower') && !ack())} onClick={() => void run(async () => { const request = publishRequest(value(), required(), ack()); await serverCommand(api => api.packBuildPublish(id(), request, intent(JSON.stringify(request)))); await load(); })}>{t('server-pack.publish')}</Button></section>}</Show>
      </></Show>
    </Show>
    <Show when={(can('pack.download') || can('pack.access'))}><section><h3>{t('server-pack.get')}</h3><p>{t('server-pack.link-help')}</p><select aria-label={t('server-pack.target')} value={target()} disabled={busy() || !!sync()} onChange={e => { discard(); setTarget(e.currentTarget.value); }}><option value="">{t('server-pack.new')}</option><For each={instances().filter(entry => /^\d+$/.test(entry.instance.id) && entry.state.kind !== 'running')}>{entry => <option value={entry.instance.id}>{entry.instance.name} � {entry.instance.minecraftVersion} � {entry.instance.modloader}</option>}</For></select><Button disabled={busy() || uncertain()} onClick={() => void run(reviewSync)}>{t('server-pack.review-install')}</Button>
    <Show when={uncertain()}><p role="alert">{t('server-pack.uncertain')}</p></Show>
    <Show when={sync()}>{value => <section><h3>{value().name}</h3><p>{value().runtime.minecraftVersion} � {value().runtime.loader} {value().runtime.loaderVersion}</p><p>{t('server-pack.release')} {value().revision} / {value().minimumRevision}</p><p>{value().serverId} � {value().fingerprint}</p><code>{value().artifactSha256}</code><For each={value().changes}>{change => <p>{change.operation}: {change.path}{change.executable ? ` (${t('server-pack.executable')})` : ''}</p>}</For><Show when={value().consentRequired}><label><input type="checkbox" checked={consent()} disabled={busy()} onChange={e => setConsent(e.currentTarget.checked)} />{t('server-pack.consent')} {value().revision}</label></Show><Button disabled={busy() || (value().consentRequired && !consent())} onClick={() => void run(() => applySync(false))}>{t('server-pack.install')}</Button><Show when={value().instanceId !== null}><Button disabled={busy()} onClick={() => void run(() => applySync(true))}>{t('server-pack.link-only')}</Button></Show><Button disabled={busy()} onClick={discard}>{t('server-pack.cancel')}</Button></section>}</Show></section></Show>
  </section>;
}





