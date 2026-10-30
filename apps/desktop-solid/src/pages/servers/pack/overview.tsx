import { Badge, Button, Dialog, Select, TextArea, TextField, toast } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { navigate } from '../../../app/router';
import { Icon } from '../../../components/icon';
import { projectPath, sourceById } from '../../../features/browse/browse-model';
import { loadVersions, peekVersions } from '../../../features/browse/browse-projects';
import { loadMetadata, loaderVersions, metadata, metadataError } from '../../../features/instances/metadata';
import { softwareIcon } from '../../../features/servers/software-flow';
import { IntentMemo, newIntentId } from '../../../features/servers/model';
import { customizingProvider, packLoaderName, packLoaders } from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import { uploadPackBytes, type PackLoader, type PackManifest } from '../../../features/servers/native-pack';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';
import { ClientModePanel } from './client-mode';
import { GetModpack } from './get-modpack';

const ICON_LIMIT = 256 * 1024;

/** Custom client pack overview: what players get, who the pack is, and getting it locally. */
export function ModpackOverview() {
  const area = useModpackArea();
  return (
    <div data-vesta="modpack-scroll">
      <div data-vesta="modpack-client">
      <ClientModePanel />
      <div data-vesta="modpack-overview">
        <div data-vesta="modpack-overview-main">
          <Show when={area.kind() === 'provider'} fallback={<IdentityPanel />}>
            <ProviderPanel />
          </Show>
          <Show when={customizingProvider(area.workspace())}>
            <p data-vesta="server-callout" data-tone="warning">{t('server-pack.customizing-help')}</p>
          </Show>
        </div>
        <aside data-vesta="modpack-overview-side">
          <GetModpack />
        </aside>
      </div>
      </div>
    </div>
  );
}

function Panel(props: { title: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <section data-vesta="modpack-panel">
      <header data-vesta="modpack-panel-head"><h3>{props.title}</h3>{props.action}</header>
      <div data-vesta="modpack-panel-body">{props.children}</div>
    </section>
  );
}

/** Custom pack identity: name, summary, version, icon and the client loader. Minecraft follows the server. */
function IdentityPanel() {
  const area = useModpackArea();
  const workspace = () => area.workspace()!;
  const [edits, setEdits] = createSignal<Partial<PackManifest>>({}, { name: 'modpack-identity:edits' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-identity:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-identity:error' });
  let picker: HTMLInputElement | undefined;
  void loadMetadata();
  // A newer draft (another tab, a reload) replaces unsaved identity edits only when there are none.
  createEffect(() => workspace().draft.revision, () => { setError(null); }, { name: 'modpack-identity:revision' });
  const value = createMemo(() => {
    const patch = edits();
    const current = { ...workspace().draft.manifest, ...patch };
    // An explicitly chosen loader can precede its metadata response. Resolve its
    // default reactively without writing edits or reusing the old loader's version.
    if (patch.loader === current.loader && current.loader !== 'none' && !current.loaderVersion) {
      return { ...current, loaderVersion: loaderVersions(workspace().serverMinecraftVersion, current.loader)[0] ?? null };
    }
    return current;
  }, { name: 'modpack-identity:value' });
  const dirty = () => Object.keys(edits()).length > 0;
  const edit = (patch: Partial<PackManifest>) => setEdits((current) => ({ ...current, ...patch }));
  const versions = () => (value().loader === 'none' ? [] : loaderVersions(workspace().serverMinecraftVersion, value().loader));
  const versionOptions = () => {
    const selected = value().loaderVersion;
    const list = versions();
    return (selected && !list.includes(selected) ? [selected, ...list] : list).map(version => ({ value: version, label: version }));
  };
  const chooseLoader = (loader: PackLoader) => {
    if (loader === value().loader) return;
    const list = loader === 'none' ? [] : loaderVersions(workspace().serverMinecraftVersion, loader);
    edit({ loader, loaderVersion: list[0] ?? null });
  };

  const save = async (patch: Partial<PackManifest> = {}) => {
    setBusy(true); setError(null);
    try {
      await area.writeManifest({ ...value(), ...patch });
      setEdits({});
      toast.show({ title: t('server-pack.saved'), tone: 'success' });
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };

  const pickIcon = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > ICON_LIMIT) { toast.show({ title: t('server-pack.icon-invalid'), tone: 'danger' }); return; }
    setBusy(true); setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const receipt = await serverCommand((api) => uploadPackBytes(api, area.id(), bytes, false, newIntentId()));
      edit({ icon: receipt.sha256 });
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };

  return (
    <Panel title={t('server-pack.identity')} action={
      <Show when={dirty()}>
        <span data-vesta="modpack-panel-actions">
          <Button size="sm" variant="ghost" disabled={busy()} onClick={() => setEdits({})}>{t('server-pack.discard')}</Button>
          <Button size="sm" tone="accent" disabled={busy() || (value().loader !== 'none' && !value().loaderVersion)} onClick={() => void save()}>{t('server-pack.save')}</Button>
        </span>
      </Show>
    }>
      <div data-vesta="modpack-identity">
        <button type="button" data-vesta="modpack-icon-pick" disabled={busy()} onClick={() => picker?.click()} aria-label={t('server-pack.icon-change')}>
          <img src={area.icon()} alt="" width={72} height={72} draggable="false" />
          <span><Icon name="icons/actions/edit" size={12} />{t('server-pack.icon-change')}</span>
        </button>
        <input ref={(element) => { picker = element; }} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void pickIcon(file); }} />
        <div data-vesta="modpack-identity-fields">
          <TextField size="sm" label={t('server-pack.name')} value={value().name} disabled={busy()} onChange={(name) => edit({ name })} />
          <TextArea size="sm" label={t('server-pack.summary')} value={value().summary} rows={2} disabled={busy()} onChange={(summary) => edit({ summary })} />
          <TextField size="sm" label={t('server-pack.version')} description={t('server-pack.version-help')} value={value().displayVersion} disabled={busy()} onChange={(displayVersion) => edit({ displayVersion })} />
          <div data-vesta="modpack-field-row">
            <Select size="sm" label={t('server-pack.loader')} value={value().loader} disabled={busy()}
              options={packLoaders.map((loader) => ({ value: loader, label: loader === 'none' ? t('server-pack.loader-none') : packLoaderName(loader), icon: () => <Icon name={softwareIcon[loader === 'none' ? 'vanilla' : loader]} size={14} /> }))}
              onChange={(loader) => chooseLoader(loader as PackLoader)} />
            <Show when={value().loader !== 'none'}>
              <Select size="sm" label={t('server-pack.loader-version')} value={value().loaderVersion ?? ''}
                placeholder={t(metadata() || metadataError() ? 'server-pack.no-loader-versions' : 'server-pack.loading-versions')}
                disabled={busy() || !versionOptions().length} options={versionOptions()}
                onChange={(loaderVersion) => edit({ loaderVersion })} />
            </Show>
          </div>
          <Show when={metadataError()}><Button size="sm" variant="ghost" onClick={() => void loadMetadata()}>{t('common.retry')}</Button></Show>
          <p data-vesta="server-muted"><Icon name="icons/security/lock" size={11} /> {t('server-pack.minecraft-help', { version: workspace().serverMinecraftVersion })}</p>
          <Show when={workspace().minecraftDrift}>
            <div data-vesta="server-callout" data-tone="warning" role="alert">
              <span>{t('server-pack.drift', { version: workspace().serverMinecraftVersion })}</span>
              <Button size="sm" variant="outline" disabled={busy()} onClick={() => void save({ minecraftVersion: workspace().serverMinecraftVersion })}>{t('server-pack.repair')}</Button>
            </div>
          </Show>
          <ServerErrorNote error={error()} />
        </div>
      </div>
    </Panel>
  );
}

/** A provider pack: where it lives, which version is served, and Customize (fork into a custom pack). */
function ProviderPanel() {
  const area = useModpackArea();
  const provider = () => area.workspace()!.providerPack!;
  const [confirming, setConfirming] = createSignal(false, { name: 'modpack-provider:confirm' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-provider:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-provider:error' });
  const intents = new IntentMemo();
  createEffect(provider, (value) => { void loadVersions(value.provider, value.projectId).catch(() => {}); }, { name: 'modpack-provider:versions' });
  const version = () => peekVersions(provider().provider, provider().projectId)?.find((entry) => entry.id === provider().versionId);
  const newer = () => {
    const list = peekVersions(provider().provider, provider().projectId) ?? [];
    const mc = area.workspace()!.serverMinecraftVersion;
    const index = list.findIndex((entry) => entry.id === provider().versionId);
    return list.slice(0, index < 0 ? 0 : index).filter((entry) => entry.game_versions.includes(mc)).length;
  };

  const customize = async () => {
    const workspace = area.workspace();
    if (!workspace) return;
    setBusy(true); setError(null);
    const request = { source: 'published' as const, expectedRevision: workspace.draft.revision, expectedPublishedRevision: workspace.publishedRevision };
    try {
      const draft = await serverCommand((api) => api.packImport(area.id(), request, intents.idFor(request)));
      intents.settle();
      area.applyDraft(draft);
      setConfirming(false);
      await area.reload();
      toast.show({ title: t('server-pack.customized'), tone: 'success' });
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setError(reason as ServerCommandError);
    } finally { setBusy(false); }
  };

  return (
    <Panel title={t('server-pack.source')}>
      <div data-vesta="modpack-source">
        <div data-vesta="modpack-source-row">
          <span data-vesta="modpack-source-provider" data-provider={provider().provider}>
            <Icon name={sourceById(provider().provider).icon} size={14} />{sourceById(provider().provider).label}
          </span>
          <a href={`#${projectPath(provider().provider, provider().projectId)}`}
            onClick={(event) => { event.preventDefault(); navigate(projectPath(provider().provider, provider().projectId)); }}>
            {area.providerProject()?.name ?? provider().projectId}
          </a>
          <Badge size="sm" variant="soft">{version()?.version_number ?? provider().versionId}</Badge>
          <Show when={newer() > 0}><Badge size="sm" tone="accent">{t('server-pack.provider-newer', { count: newer() })}</Badge></Show>
        </div>
        <p data-vesta="server-muted">{t('server-pack.provider-help')}</p>
        <div data-vesta="modpack-source-actions">
          <Button size="sm" variant="outline" icon={<Icon name="icons/actions/swap" />} onClick={() => area.open('versions')}>{t('server-pack.change-version')}</Button>
          <Button size="sm" variant="outline" icon={<Icon name="icons/actions/edit" />} onClick={() => setConfirming(true)}>{t('server-pack.customize')}</Button>
        </div>
      </div>
      <Dialog open={confirming()} onOpenChange={(open) => { if (!open && !busy()) setConfirming(false); }} closeLabel={t('nav.close')} size="sm"
        title={t('server-pack.customize-title')} description={t('server-pack.customize-description')}
        footer={<>
          <Button variant="ghost" disabled={busy()} onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={busy()} onClick={() => void customize()}>{t('server-pack.customize-confirm')}</Button>
        </>}>
        <ul data-vesta="modpack-bullets">
          <li>{t('server-pack.customize-point-copy')}</li>
          <li>{t('server-pack.customize-point-active')}</li>
          <li>{t('server-pack.customize-point-host')}</li>
        </ul>
        <ServerErrorNote error={error()} />
      </Dialog>
    </Panel>
  );
}
