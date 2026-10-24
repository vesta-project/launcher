import {
  BreadcrumbItem, Breadcrumbs, Button, ContextMenu, ContextMenuItem, ContextMenuSeparator, Dialog, IconButton, Menu, MenuItem,
  MenuSeparator, Progress, SegmentedControl, Skeleton, TextField, toast,
} from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onSettled, untrack } from 'solid-js';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { route } from '../../../app/router';
import { transitionTo } from '../../../app/transition';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { errorMessage } from '../../../features/servers/errors';
import {
  baseName, childPath, decodeRouteSegments, encodeRouteSegments, fileActions, fileIcon, fileKind, folderActions, formatBytes,
  isArchivedLog, isExecutableContent, nameProblem, openMode, parentPath, planUploads, protectedHome, sortEntries, uploadConflict, uploadLabel,
  type ConflictChoice,
} from '../../../features/servers/files-model';
import { IntentMemo, age, newIntentId } from '../../../features/servers/model';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { stableConnectionId } from '../../../features/servers/connection-id';
import type { FileEntry, ServerCommandError, ServerSnapshot, TrashEntry, UploadCandidate } from '../../../features/servers/native';
import { ServerErrorNote } from '../parts';
import { FileEditor } from './file-editor';
import { LogFile } from './log-file';
import { SftpButton } from '../hosting/sftp';
import { gate } from '../../../features/servers/capabilities';
import { useNativeDropZone } from '../../../features/file-drop/zone';
import { getDropController } from '../../../features/file-drop/native-bridge';
import { nativeInstances } from '../../../features/instances/native-service';
import { usingFixtures } from '../../../features/servers/service';
import { draggingFiles, droppedPaths, folderAt } from './files-drop';
import './files-tab.css';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (ms: number | null) => (ms === null ? '' : dateFormat.format(ms));

type Opened = { path: string; mode: 'editor' | 'log' };
type NameRequest = { kind: 'file' | 'folder' | 'rename'; entry?: FileEntry };
/** Files waiting in the upload dialog, the folder they go to, and its listing for conflicts. */
type UploadBatch = { files: UploadCandidate[]; directory: string; siblings: FileEntry[]; auto: boolean };

/** Game-root browser: one directory page at a time, with editor, log viewer, trash and transfers. */
export function FilesTab(props: { snapshot: ServerSnapshot }) {
  const id = () => props.snapshot.connection.id;
  const routePath = createMemo(() => {
    const current = route();
    return current.detail === 'files' ? decodeRouteSegments([current.item, ...current.rest]) : '';
  }, { name: 'server-files:route-path' });
  const directory = () => routePath() ?? '';
  const [entries, setEntries] = createSignal<FileEntry[]>([], { name: 'server-files:entries' });
  const [cursor, setCursor] = createSignal<string | null>(null, { name: 'server-files:cursor' });
  const [loading, setLoading] = createSignal(true, { name: 'server-files:loading' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-files:error' });
  const [view, setView] = createSignal<'browse' | 'trash'>('browse', { name: 'server-files:view' });
  const [opened, setOpened] = createSignal<Opened | null>(null, { name: 'server-files:opened' });
  const [naming, setNaming] = createSignal<NameRequest | null>(null, { name: 'server-files:naming' });
  const [deleting, setDeleting] = createSignal<FileEntry | null>(null, { name: 'server-files:deleting' });
  const [uploads, setUploads] = createSignal<UploadBatch | null>(null, { name: 'server-files:uploads' });
  /** The folder row files are being dragged over, if any; a drop there uploads into it. */
  const [dropFolder, setDropFolder] = createSignal<string | null>(null, { name: 'server-files:drop-folder' });
  /** Browser previews only: a DOM file drag is over the list. */
  const [domDrag, setDomDrag] = createSignal(false, { name: 'server-files:dom-drag' });
  const folder = () => folderActions(props.snapshot.capabilities);
  const sorted = createMemo(() => sortEntries(entries()), { name: 'server-files:sorted' });
  const pathOf = (entry: FileEntry) => (directory() ? `${directory()}/${entry.name}` : entry.name);

  // Only the newest listing applies, so a slow reply can't replace a newer directory.
  let sequence = 0;
  const load = async (path: string, more = false) => {
    const request = ++sequence;
    setLoading(true);
    setError(null);
    try {
      const page = await serverCommand((client) => client.filesList(id(), path, more ? cursor() : null));
      if (request !== sequence) return;
      setEntries((current) => (more ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (reason) {
      if (request === sequence) { setError(reason as ServerCommandError); if (!more) setEntries([]); }
    } finally {
      if (request === sequence) setLoading(false);
    }
  };
  // Fetch on navigation and explicit refresh only; no timers.
  createEffect(directory, (path) => { setOpened(null); setView('browse'); void load(path); }, { name: 'server-files:load' });
  const refresh = () => void load(untrack(directory));

  const go = (path: string) => transitionTo(`/servers/${id()}/files${path ? `/${encodeRouteSegments(path).join('/')}` : ''}`);
  const href = (path: string) => `#/servers/${encodeURIComponent(id())}/files${path ? `/${encodeRouteSegments(path).join('/')}` : ''}`;
  const crumbs = () => {
    const segments = directory() ? directory().split('/') : [];
    return segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') }));
  };

  const open = (entry: FileEntry) => {
    const path = pathOf(entry);
    const home = protectedHome(path);
    if (home) { transitionTo(`/servers/${id()}/${home}`); return; }
    const mode = openMode(path, entry);
    if (mode === 'directory') go(path);
    else if (mode === 'download') void download(path);
    else setOpened({ path, mode });
  };

  const download = async (path: string) => {
    try {
      const result = await serverCommand((client) => client.fileDownload(id(), path, isArchivedLog(path)));
      if (result.kind === 'saved') toast.show({ title: t('server-files.downloaded', { name: baseName(path), size: formatBytes(result.size) }), tone: 'success' });
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
  };

  const pickUploads = async () => {
    try {
      const picked = await serverCommand((client) => client.uploadPick());
      if (picked.length) {
        setUploads((current) => current
          ? { ...current, files: [...current.files, ...picked], auto: false }
          : { files: picked, directory: directory(), siblings: entries(), auto: false });
      }
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
  };

  // ---- Drag and drop from the OS: onto the list (this folder) or onto a folder row.
  let dropElement: HTMLDivElement | undefined;
  const dropAllowed = () => folder().upload && view() === 'browse' && !opened() && routePath() !== null && !uploads();
  const dropHint = () => (dropFolder() ? t('server-files.drop-into', { name: dropFolder()! }) : t('server-files.drop-hint'));
  const receiveDrop = async (paths: string[], into: string | null) => {
    if (!paths.length || !untrack(dropAllowed)) return;
    const current = untrack(directory);
    const target = into ? childPath(current, into) ?? current : current;
    try {
      const files = await serverCommand((client) => client.uploadDropped(paths));
      if (!files.length) return;
      // A folder row's own listing tells which names are taken there.
      const siblings = target === current ? untrack(entries) : (await serverCommand((client) => client.filesList(id(), target, null))).items;
      setUploads({ files, directory: target, siblings, auto: true });
    } catch {
      toast.show({ title: t('server-files.drop-failed'), tone: 'danger' });
    }
  };
  // In the app: native drag-drop events (real paths). The hovered folder row comes from the
  // same hit list the drop controller uses, so the row and the drop agree.
  let nativeFolder: string | null = null;
  useNativeDropZone({
    element: () => dropElement,
    disabled: () => !dropAllowed(),
    hint: dropHint,
    drop: (paths) => { const into = nativeFolder; nativeFolder = null; setDropFolder(null); void receiveDrop(paths, into); },
  });
  onSettled(() => {
    if (!nativeInstances) return;
    return getDropController().observe((observation) => {
      if (observation.type === 'end') { setDropFolder(null); return; }
      const over = observation.hits[0] ? folderAt(observation.hits[0], dropElement) : null;
      nativeFolder = over;
      if (observation.type === 'move') setDropFolder(untrack(dropAllowed) ? over : null);
    });
  });
  // Browser previews: DOM drag events with the dropped entries' relative paths.
  const domDropZone = usingFixtures && !nativeInstances;
  const domHandlers = domDropZone ? {
    onDragOver: (event: DragEvent) => {
      if (!draggingFiles(event) || !dropAllowed()) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      setDomDrag(true);
      setDropFolder(folderAt(event.target, dropElement));
    },
    onDragLeave: (event: DragEvent) => {
      if (dropElement?.contains(event.relatedTarget as Node | null)) return;
      setDomDrag(false); setDropFolder(null);
    },
    onDrop: (event: DragEvent) => {
      if (!draggingFiles(event) || !dropAllowed()) return;
      event.preventDefault();
      const into = folderAt(event.target, dropElement);
      setDomDrag(false); setDropFolder(null);
      void droppedPaths(event.dataTransfer!).then((paths) => receiveDrop(paths, into));
    },
  } : {};

  const actions = (entry: FileEntry, context = false) => {
    const Item = context ? ContextMenuItem : MenuItem;
    const Separator = context ? ContextMenuSeparator : MenuSeparator;
    const path = () => pathOf(entry);
    const allowed = () => fileActions(props.snapshot.capabilities, path(), entry);
    const home = () => protectedHome(path());
    return (
      <>
        <Show when={home()}>
          <Item icon={<Icon name="icons/actions/external-link" />} onSelect={() => open(entry)}>
            {t(home() === 'settings' ? 'server-files.open-in-settings' : 'server-files.open-in-players')}
          </Item>
        </Show>
        <Show when={!home() && (allowed().open || entry.kind === 'directory')}>
          <Item icon={<Icon name={entry.kind === 'directory' ? 'icons/content/folder' : 'icons/actions/edit'} />} onSelect={() => open(entry)}>
            {t(entry.kind === 'directory' ? 'server-files.open-folder' : openMode(path(), entry) === 'log' ? 'server-files.view-log' : allowed().edit ? 'server-files.edit' : 'server-files.view')}
          </Item>
        </Show>
        <Show when={allowed().download}>
          <Item icon={<Icon name="icons/actions/download" />} onSelect={() => void download(path())}>{t('server-files.download')}</Item>
        </Show>
        <Show when={allowed().rename || allowed().delete}>
          <Separator />
        </Show>
        <Show when={allowed().rename}>
          <Item icon={<Icon name="icons/actions/edit" />} onSelect={() => setNaming({ kind: 'rename', entry })}>{t('server-files.rename')}</Item>
        </Show>
        <Show when={allowed().delete}>
          <Item icon={<Icon name="icons/actions/delete" />} tone="danger" onSelect={() => setDeleting(entry)}>{t('server-files.move-to-trash')}</Item>
        </Show>
      </>
    );
  };

  return (
    <div data-vesta="server-files">
      <header data-vesta="pane-toolbar">
        <Breadcrumbs aria-label={t('server-files.location')} class="server-files-crumbs">
          <BreadcrumbItem href={view() === 'browse' && !opened() && !crumbs().length ? undefined : href('')}>
            <span data-vesta="server-files-root"><Icon name="icons/content/folder" size={14} />{t('server-files.game-root')}</span>
          </BreadcrumbItem>
          <For each={crumbs()}>
            {(crumb, index) => (
              <BreadcrumbItem href={view() === 'browse' && !opened() && index() === crumbs().length - 1 ? undefined : href(crumb.path)}>{crumb.name}</BreadcrumbItem>
            )}
          </For>
          <Show when={view() === 'trash'}><BreadcrumbItem>{t('server-files.trash')}</BreadcrumbItem></Show>
          <Show when={opened()}>{(file) => <BreadcrumbItem>{baseName(file().path)}</BreadcrumbItem>}</Show>
        </Breadcrumbs>
        <span data-vesta="server-toolbar-spacer" />
        <Show when={!opened()}>
          <Show when={view() === 'browse'} fallback={
            <Button size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-back" />} onClick={() => setView('browse')}>{t('server-files.back-to-files')}</Button>
          }>
            <Show when={gate(props.snapshot.capabilities, 'config.view') !== 'denied'}>
              <SftpButton snapshot={props.snapshot} />
            </Show>
            <Show when={folder().trash}>
              <IconButton size="sm" variant="ghost" icon={<Icon name="icons/actions/delete" />} label={t('server-files.trash')} onClick={() => setView('trash')} />
            </Show>
            <IconButton size="sm" variant="ghost" icon={<Icon name="icons/actions/refresh" />} label={t('server-files.refresh')} disabled={loading()} onClick={refresh} />
            <Show when={folder().newFile || folder().newFolder}>
              <Menu placement="bottom-end" trigger={(menuProps) => (
                <Button {...menuProps} size="sm" variant="outline" icon={<Icon name="icons/actions/add" />}>{t('server-files.new')}</Button>
              )}>
                <Show when={folder().newFile}><MenuItem icon={<Icon name="icons/content/file-add" />} onSelect={() => setNaming({ kind: 'file' })}>{t('server-files.new-file')}</MenuItem></Show>
                <Show when={folder().newFolder}><MenuItem icon={<Icon name="icons/content/folder" />} onSelect={() => setNaming({ kind: 'folder' })}>{t('server-files.new-folder')}</MenuItem></Show>
              </Menu>
            </Show>
            <Show when={folder().upload}>
              <Button size="sm" variant="outline" icon={<Icon name="icons/actions/upload" />} onClick={() => void pickUploads()}>{t('server-files.upload')}</Button>
            </Show>
          </Show>
        </Show>
      </header>

      <Show when={opened()} keyed fallback={
        <Show when={view() === 'browse'} fallback={<TrashView snapshot={props.snapshot} onRestored={refresh} />}>
          <div data-vesta="server-pane-body" class="server-files-body" ref={dropElement} {...domHandlers}
            data-drop-zone={domDropZone ? '' : undefined}
            data-drop-target={domDrag() ? 'active' : undefined} data-drop-hint={domDrag() ? dropHint() : undefined}>
            <Show when={routePath() === null}>
              <p data-vesta="server-callout" data-tone="warning">{t('server-files.bad-route')}</p>
            </Show>
            <ServerErrorNote error={error()} onRetry={refresh} />
            <Show when={!loading() || entries().length} fallback={<FileSkeleton />}>
              <Show when={sorted().length || error()} fallback={
                <EmptyState variant="inline" icon="icons/content/folder" title={t('server-files.empty-title')} description={t('server-files.empty-description')} />
              }>
                <div data-vesta="server-file-list" role="table" aria-label={t('server-files.location')}>
                  <div data-vesta="server-file-head" role="row">
                    <span role="columnheader">{t('server-files.name')}</span>
                    <span role="columnheader">{t('server-files.size')}</span>
                    <span role="columnheader">{t('server-files.modified')}</span>
                    <span role="columnheader" aria-label={t('server-files.actions')} />
                  </div>
                  <For each={sorted()}>
                    {(entry) => (
                      <ContextMenu trigger={(contextProps) => (
                        <div {...contextProps} data-vesta="server-file-row" role="row" data-protected={protectedHome(pathOf(entry)) ? '' : undefined}
                          data-drop-folder={entry.kind === 'directory' ? entry.name : undefined}
                          data-drop-over={entry.kind === 'directory' && dropFolder() === entry.name ? '' : undefined}>
                          <button type="button" role="cell" data-vesta="server-file-open" onClick={() => open(entry)}>
                            <span data-vesta="server-file-icon" data-kind={fileKind(pathOf(entry), entry.kind)}>
                              <Icon name={fileIcon[fileKind(pathOf(entry), entry.kind)]} />
                            </span>
                            <span data-vesta="server-file-name">{entry.name}</span>
                            <Show when={protectedHome(pathOf(entry))}>
                              <Icon name="icons/security/lock" size={12} label={t('server-files.protected')} />
                            </Show>
                          </button>
                          <span role="cell" data-vesta="server-file-meta">{entry.kind === 'directory' ? '' : formatBytes(entry.size)}</span>
                          <span role="cell" data-vesta="server-file-meta">{formatDate(entry.modifiedAtMs)}</span>
                          <span role="cell">
                            <Menu placement="bottom-end" trigger={(menuProps) => (
                              <IconButton {...menuProps} variant="ghost" size="sm" tooltip={false} label={t('common.actions-for', { name: entry.name })} icon={<Icon name="icons/content/ellipsis-v" />} />
                            )}>
                              {actions(entry)}
                            </Menu>
                          </span>
                        </div>
                      )}>
                        {actions(entry, true)}
                      </ContextMenu>
                    )}
                  </For>
                </div>
                <Show when={cursor()}>
                  <Button size="sm" variant="ghost" disabled={loading()} onClick={() => void load(directory(), true)}>{t('server-files.load-more')}</Button>
                </Show>
              </Show>
            </Show>
          </div>
        </Show>
      }>
        {(file) => (
          <Show when={file.mode === 'log'} fallback={
            <FileEditor snapshot={props.snapshot} path={file.path} onClose={() => { setOpened(null); refresh(); }} onDownload={() => void download(file.path)} />
          }>
            <LogFile snapshot={props.snapshot} path={file.path} onClose={() => setOpened(null)} onSwitch={(path) => setOpened({ path, mode: 'log' })} onDownload={(path) => void download(path)} />
          </Show>
        )}
      </Show>

      <Show when={naming()} keyed>
        {(request) => (
          <NameDialog snapshot={props.snapshot} directory={directory()} siblings={entries()} request={request}
            onClose={() => setNaming(null)}
            onDone={(path) => { setNaming(null); refresh(); if (request.kind === 'file') setOpened({ path, mode: 'editor' }); }} />
        )}
      </Show>
      <Show when={deleting()} keyed>
        {(entry) => <DeleteDialog snapshot={props.snapshot} path={pathOf(entry)} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); refresh(); }} />}
      </Show>
      <Show when={uploads()} keyed>
        {(batch) => (
          <UploadDialog snapshot={props.snapshot} directory={batch.directory} siblings={batch.siblings} files={batch.files} auto={batch.auto}
            onPickMore={() => void pickUploads()}
            onRemove={(localId) => setUploads({ ...batch, files: batch.files.filter((file) => file.localId !== localId), auto: false })}
            onClose={() => { setUploads(null); refresh(); }} />
        )}
      </Show>
    </div>
  );
}

function FileSkeleton() {
  return (
    <div data-vesta="server-file-list" aria-hidden="true">
      <For each={[0, 1, 2, 3, 4, 5]}>
        {() => (
          <div data-vesta="server-file-row">
            <span data-vesta="server-file-open"><Skeleton width={20} height={20} radius={4} /><Skeleton width={180} height={12} /></span>
            <Skeleton width={48} height={12} />
            <Skeleton width={110} height={12} />
            <span />
          </div>
        )}
      </For>
    </div>
  );
}

const nameTitles: Record<NameRequest['kind'], MessageId> = {
  file: 'server-files.new-file',
  folder: 'server-files.new-folder',
  rename: 'server-files.rename',
};

/** New file, new folder and rename: one validated name inside the current directory. */
function NameDialog(props: {
  snapshot: ServerSnapshot; directory: string; siblings: FileEntry[]; request: NameRequest;
  onClose: () => void; onDone: (path: string) => void;
}) {
  const [name, setName] = createSignal(untrack(() => props.request.entry?.name ?? ''), { name: 'server-files:name' });
  const [busy, setBusy] = createSignal(false, { name: 'server-files:name-busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-files:name-error' });
  const intents = new IntentMemo();
  const problem = () => (name() ? nameProblem(name(), props.siblings, props.request.entry?.name) : null);
  const target = () => childPath(props.directory, name());
  const unchanged = () => props.request.kind === 'rename' && name().trim() === props.request.entry?.name;
  const id = props.snapshot.connection.id;

  const submit = async () => {
    const path = target();
    if (!path || problem() || unchanged()) return;
    setBusy(true); setError(null);
    const kind = props.request.kind;
    const intentId = intents.idFor({ kind, path });
    try {
      if (kind === 'folder') await serverCommand((client) => client.fileMkdir(id, path, intentId));
      else if (kind === 'file') await serverCommand((client) => client.fileWriteText(id, path, '', null, intentId));
      else await serverCommand((client) => client.fileRename(id, childPath(props.directory, props.request.entry!.name)!, path, null, intentId));
      intents.settle();
      props.onDone(path);
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setError(reason as ServerCommandError);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }} closeLabel={t('nav.close')} size="sm"
      title={t(nameTitles[props.request.kind])}
      footer={<>
        <Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button tone="accent" disabled={busy() || !name().trim() || !!problem() || unchanged()} onClick={() => void submit()}>
          {t(props.request.kind === 'rename' ? 'server-files.rename' : 'server-files.create')}
        </Button>
      </>}
    >
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <TextField label={t('server-files.name')} value={name()} onChange={setName} error={problem() ? t(problem()!) : undefined} spellcheck="false" autocomplete="off" />
      </form>
      <Show when={target() && isExecutableContent(target()!)}>
        <p data-vesta="server-callout" data-tone="warning">{t('server-files.executable-warning')}</p>
      </Show>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}

function DeleteDialog(props: { snapshot: ServerSnapshot; path: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = createSignal(false, { name: 'server-files:delete-busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-files:delete-error' });
  const intents = new IntentMemo();
  const submit = async () => {
    setBusy(true); setError(null);
    const intentId = intents.idFor({ path: props.path });
    try {
      await serverCommand((client) => client.fileDelete(props.snapshot.connection.id, props.path, null, intentId));
      intents.settle();
      toast.show({ title: t('server-files.moved-to-trash', { name: baseName(props.path) }), tone: 'neutral' });
      props.onDone();
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setError(reason as ServerCommandError);
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }} closeLabel={t('nav.close')} size="sm"
      title={t('server-files.delete-title', { name: baseName(props.path) })}
      description={t('server-files.delete-description')}
      footer={<>
        <Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button tone="danger" disabled={busy()} onClick={() => void submit()}>{t('server-files.move-to-trash')}</Button>
      </>}
    >
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}

type UploadState = { offset: number; total: number; state: 'waiting' | 'sending' | 'done' | 'failed'; error?: ServerCommandError };

/**
 * Uploads within the server's 16 MiB total, in 1 MiB chunks with per-file progress. Picked
 * and dropped files share it: names already in the folder ask Replace / Keep both / Skip,
 * dropped folders are created first, and a clean drop starts on its own.
 */
function UploadDialog(props: {
  snapshot: ServerSnapshot; directory: string; siblings: FileEntry[]; files: UploadCandidate[]; auto: boolean;
  onPickMore: () => void; onRemove: (localId: string) => void; onClose: () => void;
}) {
  const [progress, setProgress] = createSignal<Record<string, UploadState>>({}, { name: 'server-files:upload-progress' });
  const [running, setRunning] = createSignal(false, { name: 'server-files:upload-running' });
  const [choices, setChoices] = createSignal<Record<string, ConflictChoice>>({}, { name: 'server-files:upload-choices' });
  const [folderError, setFolderError] = createSignal<ServerCommandError | null>(null, { name: 'server-files:upload-folder-error' });
  const id = props.snapshot.connection.id;
  const plan = createMemo(() => planUploads(props.directory, props.files, props.siblings, choices()), { name: 'server-files:upload-plan' });
  const step = (localId: string) => plan().uploads.find((entry) => entry.localId === localId);
  const total = () => props.files.filter((file) => step(file.localId)).reduce((sum, file) => sum + Number(file.size), 0);
  const conflicts = () => props.files.filter((file) => uploadConflict(file, props.siblings));
  const canReplace = (file: UploadCandidate) => uploadConflict(file, props.siblings) === 'file'
    && fileActions(props.snapshot.capabilities, childPath(props.directory, file.name) ?? file.name, { kind: 'file', size: file.size }).delete;
  const problem = (): MessageId | null => plan().problem
    ?? (plan().folders.length && !folderActions(props.snapshot.capabilities).newFolder ? 'server-files.upload.folders-denied' : null);
  const executable = () => plan().uploads.some((entry) => isExecutableContent(entry.path));
  const finished = () => plan().uploads.length > 0 && plan().uploads.every((entry) => progress()[entry.localId]?.state === 'done');
  const ready = () => !running() && !problem() && !plan().unresolved.length && plan().uploads.length > 0;
  const where = () => (props.directory ? baseName(props.directory) : t('server-files.game-root'));
  let cancelled = false;
  let active: string | null = null;

  const put = (localId: string, next: UploadState) => setProgress((current) => ({ ...current, [localId]: next }));
  const choose = (localId: string, choice: string) => setChoices((current) => ({ ...current, [localId]: choice as ConflictChoice }));
  const start = async () => {
    const current = plan();
    setRunning(true);
    setFolderError(null);
    cancelled = false;
    // Folders first, parents before children; one that already exists is fine.
    for (const folder of current.folders) {
      try { await serverCommand((client) => client.fileMkdir(id, folder, newIntentId())); }
      catch (reason) {
        if ((reason as ServerCommandError).code === 'stale_target') continue;
        setFolderError(reason as ServerCommandError);
        setRunning(false);
        return;
      }
    }
    for (const entry of current.uploads) {
      if (cancelled) break;
      if (progress()[entry.localId]?.state === 'done') continue;
      const file = props.files.find((candidate) => candidate.localId === entry.localId)!;
      const size = Number(file.size);
      put(file.localId, { offset: 0, total: size, state: 'sending' });
      try {
        // Replace keeps the original recoverable: it goes to the trash, then the upload creates the file.
        if (entry.mode === 'replace') {
          await serverCommand((client) => client.fileDelete(id, entry.path, null, newIntentId())).catch((reason: ServerCommandError) => {
            if (reason.code !== 'not_found') throw reason;
          });
        }
        const begun = await serverCommand((client) => client.uploadBegin(id, file.localId, entry.path, null, newIntentId()));
        active = begun.uploadId;
        let offset = Number(begun.offset);
        while (offset < size) {
          if (cancelled) throw { code: 'invalid_input' } satisfies ServerCommandError;
          const chunk = await serverCommand((client) => client.uploadChunk(id, begun.uploadId));
          offset = Number(chunk.offset);
          put(file.localId, { offset, total: size, state: 'sending' });
        }
        await serverCommand((client) => client.uploadFinish(id, begun.uploadId));
        active = null;
        put(file.localId, { offset: size, total: size, state: 'done' });
      } catch (reason) {
        if (active) { const uploadId = active; active = null; void serverCommand((client) => client.uploadAbort(id, uploadId)).catch(() => {}); }
        put(file.localId, { offset: 0, total: size, state: 'failed', error: cancelled ? undefined : reason as ServerCommandError });
      }
    }
    setRunning(false);
    if (finished()) toast.show({ title: t('server-files.uploaded', { count: current.uploads.length }), tone: 'success' });
  };
  const close = () => { cancelled = true; props.onClose(); };
  // A drop with nothing to decide starts straight away; anything to choose waits for the owner.
  onSettled(() => { if (props.auto && untrack(ready)) void start(); });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }} closeLabel={t('nav.close')} size="md"
      title={props.directory ? t('server-files.upload-into-title', { name: where() }) : t('server-files.upload-title')}
      description={t('server-files.upload-description', { limit: formatBytes(16 * 1_048_576) })}
      footer={<>
        <Show when={!running() && !finished()}>
          <Button variant="ghost" icon={<Icon name="icons/actions/add" />} onClick={props.onPickMore}>{t('server-files.add-files')}</Button>
        </Show>
        <span data-vesta="server-toolbar-spacer" />
        <Button variant="ghost" onClick={close}>{finished() ? t('nav.close') : t('common.cancel')}</Button>
        <Show when={!finished()}>
          <Button tone="accent" disabled={!ready()} onClick={() => void start()}>{t('server-files.upload')}</Button>
        </Show>
      </>}
    >
      <Show when={conflicts().length && !running() && !finished()}>
        <p data-vesta="server-muted">{t('server-files.upload.choose')}</p>
      </Show>
      <ul data-vesta="server-upload-list">
        <For each={props.files}>
          {(file) => {
            const state = () => progress()[file.localId];
            const conflict = () => uploadConflict(file, props.siblings);
            const skipped = () => choices()[file.localId] === 'skip';
            const target = () => step(file.localId)?.path;
            const renamed = () => (target() && baseName(target()!) !== file.name ? baseName(target()!) : null);
            return (
              <li data-vesta="server-upload-row" data-skipped={skipped() ? '' : undefined}>
                <span data-vesta="server-file-icon" data-kind={fileKind(file.name)}><Icon name={fileIcon[fileKind(file.name)]} /></span>
                <div data-vesta="server-upload-copy">
                  <span data-vesta="server-file-name">
                    {uploadLabel(file)}
                    <Show when={renamed()}>{(name) => <span data-vesta="server-upload-renamed">{t('server-files.upload.renamed', { name: name() })}</span>}</Show>
                  </span>
                  <Show when={state() && state()!.state !== 'failed'} fallback={
                    <span data-vesta="server-file-meta" data-tone={state()?.state === 'failed' || (conflict() && !choices()[file.localId]) ? 'danger' : undefined}>
                      {state()?.error ? t(errorMessage(state()!.error))
                        : skipped() ? t('server-files.upload.skipped')
                          : conflict() === 'directory' ? t('server-files.upload.folder-exists')
                            : conflict() ? t('server-files.upload.exists') : formatBytes(file.size)}
                    </span>
                  }>
                    <Progress size="sm" value={Math.round((state()!.offset / Math.max(1, state()!.total)) * 100)}
                      tone={state()!.state === 'done' ? 'success' : 'accent'}
                      label={state()!.state === 'done' ? t('server-files.upload.done') : `${formatBytes(state()!.offset)} / ${formatBytes(state()!.total)}`} />
                  </Show>
                </div>
                <Show when={conflict() && !running() && !state()}>
                  <SegmentedControl size="sm" aria-label={t('server-files.upload.choose')} value={choices()[file.localId]}
                    onChange={(value) => choose(file.localId, value)}
                    options={[
                      { value: 'replace', label: t('server-files.upload.replace'), disabled: !canReplace(file) },
                      { value: 'keep-both', label: t('server-files.upload.keep-both') },
                      { value: 'skip', label: t('server-files.upload.skip') },
                    ]} />
                </Show>
                <Show when={!running() && state()?.state !== 'done'}>
                  <IconButton size="sm" variant="ghost" icon={<Icon name="icons/actions/close" />} label={t('common.remove')} onClick={() => props.onRemove(file.localId)} />
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
      <p data-vesta="server-muted">{t('server-files.upload-total', { size: formatBytes(total()), limit: formatBytes(16 * 1_048_576) })}</p>
      <Show when={plan().uploads.some((entry) => entry.mode === 'replace')}>
        <p data-vesta="server-muted">{t('server-files.upload.replace-note')}</p>
      </Show>
      <Show when={problem()}>
        {(message) => <p data-vesta="server-callout" data-tone="danger">{t(message())}</p>}
      </Show>
      <Show when={executable()}>
        <p data-vesta="server-callout" data-tone="warning">{t('server-files.executable-warning')}</p>
      </Show>
      <ServerErrorNote error={folderError()} />
    </Dialog>
  );
}

/** This device's trash entries on the server, each restorable to its original path. */
function TrashView(props: { snapshot: ServerSnapshot; onRestored: () => void }) {
  const now = useServersClock();
  const id = stableConnectionId(() => props.snapshot);
  const [items, setItems] = createSignal<TrashEntry[]>([], { name: 'server-trash:items' });
  const [loading, setLoading] = createSignal(true, { name: 'server-trash:loading' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-trash:error' });
  const [restoring, setRestoring] = createSignal<string | null>(null, { name: 'server-trash:restoring' });
  const canRestore = () => folderActions(props.snapshot.capabilities).newFile;
  const load = async () => {
    setLoading(true); setError(null);
    try { setItems((await serverCommand((client) => client.trashList(id(), null))).items); }
    catch (reason) { setError(reason as ServerCommandError); }
    finally { setLoading(false); }
  };
  createEffect(id, () => { void load(); }, { name: 'server-trash:load' });
  const restore = async (entry: TrashEntry) => {
    setRestoring(entry.id);
    try {
      await serverCommand((client) => client.trashRestore(id(), entry.id, newIntentId()));
      toast.show({ title: t('server-files.restored', { path: entry.path }), tone: 'success' });
      props.onRestored();
      await load();
    } catch (reason) {
      const failure = reason as ServerCommandError;
      toast.show({ title: t(failure.code === 'stale_target' ? 'server-files.restore-exists' : errorMessage(failure)), tone: 'danger' });
    } finally { setRestoring(null); }
  };
  const ago = (ms: number) => { const value = age(ms, now()); return t(value.message, { count: value.count }); };

  return (
    <div data-vesta="server-pane-body" class="server-files-body">
      <p data-vesta="server-muted">{t('server-files.trash-description')}</p>
      <ServerErrorNote error={error()} onRetry={() => void load()} />
      <Show when={!loading() || items().length} fallback={<FileSkeleton />}>
        <Show when={items().length} fallback={<EmptyState variant="inline" icon="icons/actions/delete" title={t('server-files.trash-empty')} />}>
          <div data-vesta="server-file-list" data-trash role="table" aria-label={t('server-files.trash')}>
            <For each={items()}>
              {(entry) => (
                <div data-vesta="server-file-row" role="row">
                  <span role="cell" data-vesta="server-file-open" data-static>
                    <span data-vesta="server-file-icon" data-kind={fileKind(entry.path)}><Icon name={fileIcon[fileKind(entry.path)]} /></span>
                    <span data-vesta="server-file-name">{baseName(entry.path)}</span>
                    <span data-vesta="server-file-meta">{parentPath(entry.path) || t('server-files.game-root')}</span>
                  </span>
                  <span role="cell" data-vesta="server-file-meta">{formatBytes(entry.size)}</span>
                  <span role="cell" data-vesta="server-file-meta">{t('server-files.deleted-ago', { time: ago(entry.trashedAtMs) })}</span>
                  <span role="cell">
                    <Show when={canRestore()}>
                      <Button size="sm" variant="ghost" disabled={restoring() === entry.id} onClick={() => void restore(entry)}>{t('server-files.restore')}</Button>
                    </Show>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
