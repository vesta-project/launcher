import { Badge, Button, Checkbox, Progress } from '@vesta/ui';
import { For, Show, createSignal, onCleanup, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { browseForServer } from '../../../features/browse/browse-store';
import { sourceById } from '../../../features/browse/browse-model';
import { peekProject, loadProject } from '../../../features/browse/browse-projects';
import { IntentMemo, newIntentId } from '../../../features/servers/model';
import {
  archiveDecision, archiveLinkSource, firstRunChoices, isPackArchiveName, packLoaderName, scratchSelections, type FirstRunChoice, type ModpackSection,
} from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import type { ContentProvider } from '../../../features/servers/native-content';
import { useNativeDropZone } from '../../../features/file-drop/zone';
import { uploadPackBytes, type PackArchiveInspection } from '../../../features/servers/native-pack';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';

type ChoiceCopy = { icon: string; title: MessageId; description: MessageId; action: MessageId };
const choiceCopy: Partial<Record<FirstRunChoice, ChoiceCopy>> = {
  provider: { icon: 'icons/rail/browse', title: 'server-pack.link-browse-title', description: 'server-pack.link-browse-description', action: 'server-pack.link-browse-action' },
  upload: { icon: 'icons/actions/upload', title: 'server-pack.link-upload-title', description: 'server-pack.link-upload-description', action: 'server-pack.first-upload-action' },
};
/** The client pack's starting points: one line each, the whole tile is the action. */
const startCopy: Partial<Record<FirstRunChoice, { icon: string; title: MessageId; hint: MessageId }>> = {
  link: { icon: 'icons/content/modpack', title: 'server-pack.first-link-title', hint: 'server-pack.first-link-hint' },
  upload: { icon: 'icons/actions/upload', title: 'server-pack.first-file-title', hint: 'server-pack.first-file-hint' },
  scratch: { icon: 'icons/actions/add', title: 'server-pack.first-scratch-title', hint: 'server-pack.first-scratch-hint' },
};

type Upload =
  | { step: 'uploading'; name: string }
  | { step: 'inspected'; name: string; uploadId: string; inspection: PackArchiveInspection }
  | { step: 'applying'; name: string; uploadId: string; inspection: PackArchiveInspection };

/**
 * Nothing set up yet. `server`: the server doesn't use a modpack (fine; it is optional): link
 * one from a provider or a file through the link review. `client`: link a provider modpack (as
 * the client pack's own link card does), start from a file, or start from scratch.
 */
export function FirstRun(props: { section: ModpackSection }) {
  const area = useModpackArea();
  const section = untrack(() => props.section);
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
    browseForServer({
      id: area.id(), name: area.snapshot().connection.name, type: 'modpack', minecraftVersion: workspace?.serverMinecraftVersion ?? null, loader: null,
      destination: section === 'client' ? 'modpack' : undefined,
    });
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

  let archiveElement: HTMLElement | undefined;
  useNativeDropZone({ element: () => archiveElement, disabled: () => !!upload() || scratch(), drop: paths => {
    if (paths.length !== 1 || !isPackArchiveName(paths[0]!)) { setBadFile(true); return; }
    const name = paths[0]!.split(/[\\/]/).at(-1)!;
    setUpload({ step: 'uploading', name }); setError(null);
    void (async () => {
      try {
        const files = await serverCommand(api => api.packUploadDropped(area.id(), paths, true));
        const receipt = files[0]!.receipt;
        const inspection = await serverCommand(api => api.packArchiveInspect(area.id(), receipt.uploadId));
        if (disposed) { void cancelUpload(receipt.uploadId); return; }
        setUpload({ step: 'inspected', name, uploadId: receipt.uploadId, inspection });
      } catch (reason) { if (!disposed) { setUpload(null); setError(reason as ServerCommandError); } }
    })();
  } });
  const fileDrop = {
    onDragOver: (event: DragEvent) => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => { event.preventDefault(); setDragging(false); void receive(event.dataTransfer?.files[0]); },
  };
  const choose = (choice: FirstRunChoice) => {
    if (choice === 'provider' || choice === 'link') browse();
    else if (choice === 'upload') picker?.click();
    else setScratch(true);
  };

  return (
    <section data-vesta="modpack-first" data-section={section} aria-labelledby="modpack-first-title">
      <header data-vesta="modpack-first-head">
        <Show when={section === 'server'}><span data-vesta="modpack-first-mark" aria-hidden="true"><Icon name="icons/content/server" size={22} /></span></Show>
        <div>
          <h2 id="modpack-first-title">{section === 'server' ? t('server-pack.link-none-title') : t('server-pack.first-title')}</h2>
          <Show when={section === 'server'}><p>{t('server-pack.link-none-description')}</p></Show>
        </div>
      </header>
      <Show when={section === 'server' && !area.gates().installOnServer}>
        <p data-vesta="server-muted">{t(area.snapshot().status?.state === 'stopped' ? 'server-pack.link-no-permission' : 'server-pack.stop-to-install')}</p>
      </Show>
      <ServerErrorNote error={error()} />
      <input ref={(element) => { picker = element; }} type="file" accept=".mrpack,.zip,application/zip" hidden
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
                <ArchiveResult section={section} name={inspected.name} uploadId={inspected.uploadId} inspection={inspected.inspection}
                  onCancel={() => { void cancelUpload(inspected.uploadId); setUpload(null); }}
                  onApplying={(busy) => setUpload(busy ? { ...inspected, step: 'applying' } : { ...inspected, step: 'inspected' })}
                  onDone={() => setUpload(null)} />
              )}
            </Show>
          )}
        </Show>
      }>
        <Show when={section === 'client'} fallback={
        <div data-vesta="modpack-choices">
          <For each={firstRunChoices(section, area.gates())}>
            {(choice) => {
              const copy = choiceCopy[choice.id]!;
              const dropProps = choice.id === 'upload' ? fileDrop : {};
              return (
                <article ref={element => { if (choice.id === 'upload') archiveElement = element; }} data-vesta="modpack-choice" data-choice={choice.id} data-drop-target={choice.id === 'upload' && dragging() ? 'active' : undefined} {...dropProps}>
                  <span data-vesta="modpack-choice-icon" aria-hidden="true"><Icon name={copy.icon} size={18} /></span>
                  <h3>{t(copy.title)}</h3>
                  <p>{t(copy.description)}</p>
                  <Show when={choice.id === 'upload'}>
                    <p data-vesta="modpack-choice-hint">{t('server-pack.first-upload-hint')}</p>
                  </Show>
                  <Button size="sm" tone="neutral" variant="outline"
                    disabled={!choice.enabled} onClick={() => choose(choice.id)}>{t(copy.action)}</Button>
                </article>
              );
            }}
          </For>
        </div>
        }>
          <div data-vesta="modpack-starts" role="group" aria-labelledby="modpack-first-title">
            <For each={firstRunChoices(section, area.gates())}>
              {(choice) => {
                const copy = startCopy[choice.id]!;
                return (
                  <button type="button" data-vesta="modpack-start" data-choice={choice.id}
                    ref={element => { if (choice.id === 'upload') archiveElement = element; }}
                    data-drop-target={choice.id === 'upload' && dragging() ? 'active' : undefined}
                    disabled={!choice.enabled} onClick={() => choose(choice.id)} {...(choice.id === 'upload' ? fileDrop : {})}>
                    <span data-vesta="modpack-start-icon" aria-hidden="true"><Icon name={copy.icon} size={16} /></span>
                    <span data-vesta="modpack-start-text">
                      <strong>{t(copy.title)}</strong>
                      <span>{t(copy.hint)}</span>
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
        <Show when={badFile()}><p data-vesta="server-callout" data-tone="warning" role="alert">{t('server-pack.upload-bad-file')}</p></Show>
      </Show>
    </section>
  );
}

/**
 * The inspected archive. For the server it goes to the link review (an identified provider pack
 * links to that provider version so updates can be found). For the client pack it becomes the
 * hosted custom pack.
 */
function ArchiveResult(props: {
  section: ModpackSection; name: string; uploadId: string; inspection: PackArchiveInspection;
  onCancel: () => void; onApplying: (busy: boolean) => void; onDone: () => void;
}) {
  const area = useModpackArea();
  const decision = () => archiveDecision(props.inspection);
  const manifest = () => props.inspection.manifest;
  const [busy, setBusy] = createSignal(false, { name: 'modpack-archive:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-archive:error' });
  const intents = new IntentMemo();
  const link = () => decision().link;
  const linkProject = () => { const value = link(); return value ? peekProject(value.provider, value.projectId) : undefined; };
  const linked = untrack(link);
  if (linked) void loadProject(linked.provider, linked.projectId).catch(() => {});

  /** Server: hand the file to the link review, which owns the upload from here. */
  const review = () => {
    const source = archiveLinkSource(props.inspection, props.uploadId);
    // A provider link reads the provider, not the file: the upload is no longer needed.
    if (source.source === 'provider') void serverCommand((api) => api.packUploadCancel(area.id(), props.uploadId, newIntentId())).catch(() => {});
    area.startInstall({ source, name: linkProject()?.name ?? manifest().name, mode: 'link', uploadId: source.source === 'uploaded_archive' ? props.uploadId : undefined });
    props.onDone();
  };

  const host = async () => {
    const workspace = area.workspace();
    if (!workspace || busy()) return;
    setBusy(true); setError(null); props.onApplying(true);
    try {
      const request = { source: 'uploaded_archive' as const, expectedRevision: workspace.draft.revision, uploadId: props.uploadId };
      const draft = await serverCommand((api) => api.packImport(area.id(), request, intents.idFor(['host', request])));
      intents.settle();
      area.applyDraft(draft);
      area.markStarted();
      await area.reload();
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
      <Show when={props.section === 'server'} fallback={<p data-vesta="server-muted">{t('server-pack.archive-host-help')}</p>}>
        <Show when={link()} fallback={<p data-vesta="server-muted">{t('server-pack.archive-link-file-help')}</p>}>
          {(provider) => <ProviderLinkNote provider={provider()} name={linkProject()?.name} />}
        </Show>
      </Show>
      <ServerErrorNote error={error()} />
      <footer data-vesta="modpack-card-actions">
        <Button variant="ghost" disabled={busy()} onClick={props.onCancel}>{t('common.cancel')}</Button>
        <span data-vesta="server-toolbar-spacer" />
        <Show when={props.section === 'server'} fallback={
          <Button tone="accent" disabled={busy()} onClick={() => void host()}>{t('server-pack.use-as-client-pack')}</Button>
        }>
          <Button tone="accent" disabled={busy() || !area.gates().installOnServer} onClick={review}>{t('server-pack.link-review')}</Button>
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

