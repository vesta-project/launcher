import { Badge, Button, Checkbox, Progress } from '@vesta/ui';
import { For, Show, createSignal, onCleanup, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { browseForServer } from '../../../features/browse/browse-store';
import { sourceById } from '../../../features/browse/browse-model';
import { peekProject, loadProject } from '../../../features/browse/browse-projects';
import { IntentMemo, newIntentId } from '../../../features/servers/model';
import {
  archiveDecision, firstRunChoices, isPackArchiveName, packLoaderName, scratchSelections, type FirstRunChoice,
} from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import type { ContentProvider } from '../../../features/servers/native-content';
import { uploadPackBytes, type PackArchiveInspection } from '../../../features/servers/native-pack';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';

const choiceCopy: Record<FirstRunChoice, { icon: string; title: MessageId; description: MessageId; action: MessageId }> = {
  provider: { icon: 'icons/rail/browse', title: 'server-pack.first-provider-title', description: 'server-pack.first-provider-description', action: 'server-pack.first-provider-action' },
  upload: { icon: 'icons/actions/upload', title: 'server-pack.first-upload-title', description: 'server-pack.first-upload-description', action: 'server-pack.first-upload-action' },
  scratch: { icon: 'icons/actions/add', title: 'server-pack.first-scratch-title', description: 'server-pack.first-scratch-description', action: 'server-pack.first-scratch-action' },
};

type Upload =
  | { step: 'uploading'; name: string }
  | { step: 'inspected'; name: string; uploadId: string; inspection: PackArchiveInspection }
  | { step: 'applying'; name: string; uploadId: string; inspection: PackArchiveInspection };

/** A server without a modpack: link one from a provider, upload one, or build one. */
export function FirstRun() {
  const area = useModpackArea();
  const [upload, setUpload] = createSignal<Upload | null>(null, { name: 'modpack-first:upload' });
  const [scratch, setScratch] = createSignal(false, { name: 'modpack-first:scratch' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-first:error' });
  const [dragging, setDragging] = createSignal(false, { name: 'modpack-first:dragging' });
  const [badFile, setBadFile] = createSignal(false, { name: 'modpack-first:bad-file' });
  let picker: HTMLInputElement | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    // An inspected upload nobody used is cancelled rather than abandoned.
    const current = untrack(upload);
    if (current && current.step === 'inspected') void cancelUpload(current.uploadId);
  });

  const cancelUpload = (uploadId: string) =>
    serverCommand((api) => api.packUploadCancel(area.id(), uploadId, newIntentId())).catch(() => {});

  const browse = () => {
    const workspace = area.workspace();
    browseForServer({ id: area.id(), name: area.snapshot().connection.name, type: 'modpack', minecraftVersion: workspace?.serverMinecraftVersion ?? null, loader: null });
  };

  const receive = async (file: File | undefined) => {
    if (!file) return;
    setBadFile(false); setError(null);
    if (!isPackArchiveName(file.name)) { setBadFile(true); return; }
    setUpload({ step: 'uploading', name: file.name });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const receipt = await serverCommand((api) => uploadPackBytes(api, area.id(), bytes, true, newIntentId()));
      const inspection = await serverCommand((api) => api.packArchiveInspect(area.id(), receipt.uploadId));
      if (disposed) { void cancelUpload(receipt.uploadId); return; }
      setUpload({ step: 'inspected', name: file.name, uploadId: receipt.uploadId, inspection });
    } catch (reason) {
      if (disposed) return;
      setUpload(null);
      setError(reason as ServerCommandError);
    }
  };

  const choose = (choice: FirstRunChoice) => {
    if (choice === 'provider') browse();
    else if (choice === 'upload') picker?.click();
    else setScratch(true);
  };

  return (
    <section data-vesta="modpack-first" aria-labelledby="modpack-first-title">
      <header data-vesta="modpack-first-head">
        <span data-vesta="modpack-first-mark" aria-hidden="true"><Icon name="icons/content/modpack" size={22} /></span>
        <div>
          <h2 id="modpack-first-title">{t('server-pack.first-title', { name: area.snapshot().connection.name })}</h2>
          <p>{t('server-pack.first-description')}</p>
        </div>
      </header>
      <ServerErrorNote error={error()} />
      <input ref={picker} type="file" accept=".mrpack,.zip,application/zip" hidden
        onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void receive(file); }} />
      <Show when={!upload() && !scratch()} fallback={
        <Show when={upload()} keyed fallback={<ScratchStep onBack={() => setScratch(false)} />}>
          {(current) => (
            <Show when={current.step !== 'uploading' ? current : undefined} keyed fallback={
              <div data-vesta="modpack-card" data-busy="">
                <p data-vesta="modpack-card-title"><Icon name="icons/actions/upload" size={14} />{t('server-pack.uploading', { name: current.name })}</p>
                <Progress size="sm" label={t('server-pack.inspecting')} />
              </div>
            }>
              {(inspected) => (
                <ArchiveResult name={inspected.name} uploadId={inspected.uploadId} inspection={inspected.inspection}
                  onCancel={() => { void cancelUpload(inspected.uploadId); setUpload(null); }}
                  onApplying={(busy) => setUpload(busy ? { ...inspected, step: 'applying' } : { ...inspected, step: 'inspected' })}
                  onDone={() => setUpload(null)} />
              )}
            </Show>
          )}
        </Show>
      }>
        <div data-vesta="modpack-choices">
          <For each={firstRunChoices(area.gates())}>
            {(choice) => {
              const copy = choiceCopy[choice.id];
              const dropProps = choice.id === 'upload' ? {
                onDragOver: (event: DragEvent) => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); setDragging(true); },
                onDragLeave: () => setDragging(false),
                onDrop: (event: DragEvent) => { event.preventDefault(); setDragging(false); void receive(event.dataTransfer?.files[0]); },
              } : {};
              return (
                <article data-vesta="modpack-choice" data-choice={choice.id} data-drop-target={choice.id === 'upload' && dragging() ? 'active' : undefined} {...dropProps}>
                  <span data-vesta="modpack-choice-icon" aria-hidden="true"><Icon name={copy.icon} size={18} /></span>
                  <h3>{t(copy.title)}</h3>
                  <p>{t(copy.description)}</p>
                  <Show when={choice.id === 'upload'}>
                    <p data-vesta="modpack-choice-hint">{t('server-pack.first-upload-hint')}</p>
                  </Show>
                  <Button size="sm" tone={choice.id === 'provider' ? 'accent' : 'neutral'} variant={choice.id === 'provider' ? 'solid' : 'outline'}
                    disabled={!choice.enabled} onClick={() => choose(choice.id)}>{t(copy.action)}</Button>
                </article>
              );
            }}
          </For>
        </div>
        <Show when={badFile()}><p data-vesta="server-callout" data-tone="warning" role="alert">{t('server-pack.upload-bad-file')}</p></Show>
      </Show>
    </section>
  );
}

/**
 * The inspected archive. A pack the agent identified on a provider is linked (nothing hosted);
 * anything else becomes this server's hosted custom pack. Either can also be installed on the server.
 */
function ArchiveResult(props: {
  name: string; uploadId: string; inspection: PackArchiveInspection;
  onCancel: () => void; onApplying: (busy: boolean) => void; onDone: () => void;
}) {
  const area = useModpackArea();
  const decision = () => archiveDecision(props.inspection);
  const manifest = () => props.inspection.manifest;
  const [alsoInstall, setAlsoInstall] = createSignal(false, { name: 'modpack-archive:install' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-archive:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-archive:error' });
  const intents = new IntentMemo();
  const link = () => decision().link;
  const linkProject = () => { const value = link(); return value ? peekProject(value.provider, value.projectId) : undefined; };
  const linked = link();
  if (linked) void loadProject(linked.provider, linked.projectId).catch(() => {});

  const act = async (mode: 'link' | 'host') => {
    const workspace = area.workspace();
    if (!workspace || busy()) return;
    setBusy(true); setError(null); props.onApplying(true);
    try {
      if (mode === 'link') {
        const provider = link()!;
        const request = { ...provider, expectedRevision: workspace.publishedRevision, draftRevision: workspace.draft.revision, requiredUpdate: false, acknowledgeLowerVersion: false };
        await serverCommand((api) => api.packProviderPublish(area.id(), request, intents.idFor(['link', request])));
        intents.settle();
        await serverCommand((api) => api.packUploadCancel(area.id(), props.uploadId, newIntentId())).catch(() => {});
        await area.reload();
        if (alsoInstall()) area.startInstall({ source: { source: 'provider', ...provider }, name: linkProject()?.name ?? manifest().name, setAsModpack: false });
      } else {
        // The plan reads the upload, so it is reviewed before the import uses it.
        if (alsoInstall()) area.startInstall({ source: { source: 'uploaded_archive', uploadId: props.uploadId }, name: manifest().name, setAsModpack: false });
        const request = { source: 'uploaded_archive' as const, expectedRevision: workspace.draft.revision, uploadId: props.uploadId };
        const draft = await serverCommand((api) => api.packImport(area.id(), request, intents.idFor(['host', request])));
        intents.settle();
        area.applyDraft(draft);
        area.markStarted();
        await area.reload();
      }
      props.onDone();
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setError(reason as ServerCommandError);
      props.onApplying(false);
    } finally { setBusy(false); }
  };

  const facts = () => [
    { label: t('server-pack.archive-format'), value: t(decision().formatLabel) },
    { label: t('server-pack.archive-minecraft'), value: manifest().minecraftVersion },
    { label: t('server-pack.archive-loader'), value: `${packLoaderName(manifest().loader)}${manifest().loaderVersion ? ` ${manifest().loaderVersion}` : ''}` },
    { label: t('server-pack.archive-entries'), value: String(props.inspection.entryCount) },
    { label: t('server-pack.archive-overrides'), value: String(props.inspection.overrides.length) },
  ];

  return (
    <div data-vesta="modpack-card" data-vesta-result="archive">
      <div data-vesta="modpack-card-head">
        <span data-vesta="modpack-choice-icon" aria-hidden="true"><Icon name="icons/content/modpack" size={18} /></span>
        <div>
          <p data-vesta="modpack-eyebrow">{t('server-pack.archive-detected', { name: props.name })}</p>
          <h3>{manifest().name}</h3>
        </div>
        <Badge size="sm" variant="soft" tone={link() ? 'accent' : 'neutral'}>{t(decision().formatLabel)}</Badge>
      </div>
      <dl data-vesta="modpack-facts">
        <For each={facts()}>{(fact) => <div><dt>{fact.label}</dt><dd>{fact.value}</dd></div>}</For>
      </dl>
      <Show when={manifest().minecraftVersion !== area.workspace()?.serverMinecraftVersion}>
        <p data-vesta="server-callout" data-tone="warning">{t('server-pack.archive-minecraft-differs', { version: area.workspace()?.serverMinecraftVersion ?? '' })}</p>
      </Show>
      <Show when={decision().runtimeInferred}>
        <p data-vesta="server-callout" data-tone="neutral">{t('server-pack.archive-runtime-inferred')}</p>
      </Show>
      <Show when={decision().unresolved.length}>
        <details data-vesta="modpack-unresolved">
          <summary>{t('server-pack.archive-unresolved', { count: decision().unresolved.length })}</summary>
          <ul><For each={decision().unresolved}>{(path) => <li><code>{path}</code></li>}</For></ul>
          <p data-vesta="server-muted">{t('server-pack.archive-unresolved-help')}</p>
        </details>
      </Show>
      <Show when={link()} fallback={<p data-vesta="server-muted">{t('server-pack.archive-host-help')}</p>}>
        {(provider) => <ProviderLinkNote provider={provider()} name={linkProject()?.name} />}
      </Show>
      <ServerErrorNote error={error()} />
      <Show when={area.gates().installOnServer}>
        <Checkbox size="sm" checked={alsoInstall()} onChange={setAlsoInstall} disabled={busy()}
          label={t('server-pack.also-install')} description={t('server-pack.also-install-help')} />
      </Show>
      <footer data-vesta="modpack-card-actions">
        <Button variant="ghost" disabled={busy()} onClick={props.onCancel}>{t('common.cancel')}</Button>
        <span data-vesta="server-toolbar-spacer" />
        <Show when={link()} fallback={
          <Button tone="accent" disabled={busy()} onClick={() => void act('host')}>{t('server-pack.use-as-modpack', { name: area.snapshot().connection.name })}</Button>
        }>
          {(provider) => (
            <>
              <Button variant="outline" disabled={busy()} onClick={() => void act('host')}>{t('server-pack.host-copy')}</Button>
              <Button tone="accent" disabled={busy()} onClick={() => void act('link')}>{t('server-pack.link-provider', { provider: sourceById(provider().provider).label })}</Button>
            </>
          )}
        </Show>
      </footer>
    </div>
  );
}

function ProviderLinkNote(props: { provider: ContentProvider; name?: string }) {
  return (
    <p data-vesta="server-callout" data-tone="accent">
      <Icon name={sourceById(props.provider.provider).icon} size={14} />
      {t('server-pack.archive-provider-found', { provider: sourceById(props.provider.provider).label, name: props.name ?? props.provider.projectId })}
    </p>
  );
}

/** Start from scratch: the client mods the server's own content needs, chosen explicitly. */
function ScratchStep(props: { onBack: () => void }) {
  const area = useModpackArea();
  const [found, setFound] = createSignal<ContentProvider[] | null>(null, { name: 'modpack-scratch:found' });
  const [picked, setPicked] = createSignal<ReadonlySet<string>>(new Set(), { name: 'modpack-scratch:picked' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-scratch:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-scratch:error' });
  const intents = new IntentMemo();
  const key = (item: ContentProvider) => `${item.provider}:${item.projectId}`;
  void serverCommand((api) => api.packSuggestions(area.id())).then((value) => {
    const items = scratchSelections(value.items);
    for (const item of items) void loadProject(item.provider, item.projectId).catch(() => {});
    setFound(items);
    setPicked(new Set(items.map(key)));
  }).catch((reason) => { setError(reason as ServerCommandError); setFound([]); });

  const toggle = (item: ContentProvider, on: boolean) => setPicked((current) => {
    const next = new Set(current);
    if (on) next.add(key(item)); else next.delete(key(item));
    return next;
  });

  const create = async () => {
    const workspace = area.workspace();
    if (!workspace) return;
    const chosen = (found() ?? []).filter((item) => picked().has(key(item)));
    setBusy(true); setError(null);
    try {
      if (chosen.length) {
        const [root, ...rest] = chosen;
        const request = { ...root!, expectedRevision: workspace.draft.revision, required: true, dependencies: rest.map((item) => ({ ...item, required: true })) };
        const draft = await serverCommand((api) => api.packAdd(area.id(), request, intents.idFor(request)));
        intents.settle();
        area.applyDraft(draft);
      }
      area.markStarted();
      area.open('overview');
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setError(reason as ServerCommandError);
    } finally { setBusy(false); }
  };

  return (
    <div data-vesta="modpack-card">
      <div data-vesta="modpack-card-head">
        <span data-vesta="modpack-choice-icon" aria-hidden="true"><Icon name="icons/actions/add" size={18} /></span>
        <div>
          <p data-vesta="modpack-eyebrow">{t('server-pack.first-scratch-title')}</p>
          <h3>{t('server-pack.scratch-title')}</h3>
        </div>
      </div>
      <p data-vesta="server-muted">{t('server-pack.scratch-description')}</p>
      <ServerErrorNote error={error()} />
      <Show when={found()} fallback={<Progress size="sm" label={t('server-pack.scratch-loading')} />}>
        {(items) => (
          <Show when={items().length} fallback={<p data-vesta="server-muted">{t('server-pack.scratch-none')}</p>}>
            <ul data-vesta="modpack-pick-list">
              <For each={items()}>
                {(item) => (
                  <li>
                    <Checkbox size="sm" checked={picked().has(key(item))} onChange={(on) => toggle(item, on)}
                      label={peekProject(item.provider, item.projectId)?.name ?? item.projectId}
                      description={sourceById(item.provider).label} />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
      <footer data-vesta="modpack-card-actions">
        <Button variant="ghost" disabled={busy()} onClick={props.onBack}>{t('server-pack.back')}</Button>
        <span data-vesta="server-toolbar-spacer" />
        <Button tone="accent" disabled={busy() || !found()} onClick={() => void create()}>
          {picked().size ? t('server-pack.scratch-create-count', { count: picked().size }) : t('server-pack.scratch-create')}
        </Button>
      </footer>
    </div>
  );
}

