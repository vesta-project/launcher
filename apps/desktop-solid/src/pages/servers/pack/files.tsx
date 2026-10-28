import {
  BreadcrumbItem, Breadcrumbs, Button, ContextMenu, ContextMenuItem, ContextMenuSeparator, IconButton, Menu, MenuItem, MenuSeparator,
  SegmentedControl, toast,
} from '@vesta/ui';
import { For, Show, createMemo, createSignal, untrack } from 'solid-js';
import { route } from '../../../app/router';
import { transitionTo } from '../../../app/transition';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { baseName, decodeRouteSegments, encodeRouteSegments, fileIcon, fileKind, type TextFileSource } from '../../../features/servers/files-model';
import { newIntentId } from '../../../features/servers/model';
import {
  asPackText, base64ToBytes, bytesToBase64, isPackRoot, packDirectory, packFileRoots, packRootCounts, packUploadTarget,
  type PackFileRow,
} from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import { uploadPackBytes, type PackFileOperation, type PackOverrideRoot } from '../../../features/servers/native-pack';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { FileEditor } from '../tabs/file-editor';
import { DeleteDialog, NameDialog, type NameRequest } from '../tabs/files-tab';
import { useNativeDropZone } from '../../../features/file-drop/zone';
import { draggingFiles } from '../tabs/files-drop';
import { useModpackArea } from './area';
import '../tabs/files-tab.css';

/**
 * Files: the pack's override files (configs and the like) in three roots, browsed and edited with
 * the server Files tab's list, dialogs and editor. Every change is a draft edit; nothing reaches
 * players until the pack is published.
 */
export function ModpackFiles() {
  const area = useModpackArea();
  const location = createMemo(() => {
    const current = route();
    const [first, ...rest] = current.detail === 'pack' && current.item === 'files' ? current.rest : [];
    const root: PackOverrideRoot = isPackRoot(first) ? first : 'overrides';
    return { root, directory: decodeRouteSegments(rest) ?? '' };
  }, { name: 'modpack-files:location' });
  const root = () => location().root;
  const directory = () => location().directory;
  const files = () => area.workspace()!.draft.manifest.overrideFiles ?? [];
  const rows = createMemo(() => packDirectory(files(), root(), directory()), { name: 'modpack-files:rows' });
  const counts = createMemo(() => packRootCounts(files()), { name: 'modpack-files:counts' });
  const [opened, setOpened] = createSignal<{ root: PackOverrideRoot; path: string } | null>(null, { name: 'modpack-files:opened' });
  const [naming, setNaming] = createSignal<NameRequest | null>(null, { name: 'modpack-files:naming' });
  const [deleting, setDeleting] = createSignal<PackFileRow | null>(null, { name: 'modpack-files:deleting' });
  const [uploading, setUploading] = createSignal(0, { name: 'modpack-files:uploading' });
  const [dragging, setDragging] = createSignal(false, { name: 'modpack-files:dragging' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-files:error' });
  let picker: HTMLInputElement | undefined;

  const go = (next: PackOverrideRoot, path = '') => {
    setOpened(null);
    transitionTo(`/servers/${area.id()}/pack/files/${next}${path ? `/${encodeRouteSegments(path).join('/')}` : ''}`);
  };
  const href = (path: string) => `#/servers/${encodeURIComponent(area.id())}/pack/files/${root()}${path ? `/${encodeRouteSegments(path).join('/')}` : ''}`;
  const crumbs = () => {
    const segments = directory() ? directory().split('/') : [];
    return segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') }));
  };

  /** One draft edit; the returned draft becomes the workspace. A stale draft is reread first. */
  const mutate = async (change: PackFileOperation, intentId: string) => {
    const expectedRevision = untrack(area.workspace)!.draft.revision;
    try {
      area.applyDraft(await serverCommand((api) => api.packFileMutate(area.id(), { expectedRevision, change }, intentId)));
    } catch (reason) {
      if ((reason as ServerCommandError).code === 'stale_target') await area.reload();
      throw reason;
    }
  };

  /** The text source the shared editor saves through: the file's hash in the draft is its validator. */
  const source = (fileRoot: PackOverrideRoot): TextFileSource => ({
    kind: 'pack',
    async read(path) {
      const expectedRevision = untrack(area.workspace)!.draft.revision;
      const body = await serverCommand((api) => api.packFileRead(area.id(), { expectedRevision, root: fileRoot, path }));
      const bytes = base64ToBytes(body.contentBase64);
      const text = asPackText(bytes);
      return { text: text ?? '', sha256: body.sha256, size: String(bytes.length), binary: text === null, truncated: false };
    },
    async write(path, text, validator, intentId) {
      const current = (untrack(area.workspace)!.draft.manifest.overrideFiles ?? []).find((file) => !file.trashed && file.root === fileRoot && file.path === path);
      if (validator && current?.sha256 && current.sha256 !== validator) throw { code: 'stale_target' } satisfies ServerCommandError;
      const bytes = new TextEncoder().encode(text);
      await mutate({ operation: 'write', root: fileRoot, path, contentBase64: bytesToBase64(bytes) }, intentId);
      const saved = (untrack(area.workspace)!.draft.manifest.overrideFiles ?? []).find((file) => !file.trashed && file.root === fileRoot && file.path === path);
      return { sha256: saved?.sha256 ?? '', size: String(bytes.length) };
    },
  });

  const open = (row: PackFileRow) => {
    if (row.kind === 'directory') go(root(), row.path);
    else setOpened({ root: root(), path: row.path });
  };

  const name = (kind: NameRequest['kind'], path: string, from: string | null, intentId: string) => {
    if (kind === 'folder') return mutate({ operation: 'mkdir', root: root(), path }, intentId);
    if (kind === 'rename') return mutate({ operation: 'rename', root: root(), path: from!, destination: path }, intentId);
    const target = packUploadTarget(directory(), baseName(path), 0);
    if ('problem' in target) throw { code: 'invalid_input' } satisfies ServerCommandError;
    return mutate({ operation: 'write', root: root(), path, contentBase64: '' }, intentId);
  };

  const upload = async (list: readonly File[]) => {
    setError(null);
    const into = { root: root(), directory: directory() };
    for (const file of list) {
      const target = packUploadTarget(into.directory, file.name, file.size);
      if ('problem' in target) { toast.show({ title: t(target.problem), description: file.name, tone: 'danger' }); continue; }
      setUploading((count) => count + 1);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const text = asPackText(bytes);
        if (text !== null) await mutate({ operation: 'write', root: into.root, path: target.path, contentBase64: bytesToBase64(bytes) }, newIntentId());
        else {
          const receipt = await serverCommand((api) => uploadPackBytes(api, area.id(), bytes, false, newIntentId()));
          await mutate({ operation: 'attach', root: into.root, path: target.path, sha256: receipt.sha256 }, newIntentId());
        }
        toast.show({ title: t('server-pack.file-uploaded', { name: file.name }), tone: 'success' });
      } catch (reason) { setError(reason as ServerCommandError); }
      finally { setUploading((count) => count - 1); }
    }
  };

  let dropElement: HTMLDivElement | undefined;
  useNativeDropZone({ element: () => dropElement, disabled: () => !area.gates().edit || !!opened() || uploading() > 0,
    drop: (paths) => { void (async () => {
      const into = { root: root(), directory: directory() }; setUploading(1); setError(null);
      try {
        const files = await serverCommand(api => api.packUploadDropped(area.id(), paths, false));
        for (const file of files) {
          const target = packUploadTarget(into.directory, file.path, Number(file.receipt.size));
          if ('problem' in target) { toast.show({ title: t(target.problem), tone: 'danger' }); continue; }
          await mutate({ operation: 'attach', root: into.root, path: target.path, sha256: file.receipt.sha256 }, newIntentId());
        }
      } catch (reason) { setError(reason as ServerCommandError); } finally { setUploading(0); }
    })(); },
  });
  const actions = (row: PackFileRow, context = false) => {
    const Item = context ? ContextMenuItem : MenuItem;
    const Separator = context ? ContextMenuSeparator : MenuSeparator;
    return (
      <>
        <Item icon={<Icon name={row.kind === 'directory' ? 'icons/content/folder' : 'icons/actions/edit'} />} onSelect={() => open(row)}>
          {t(row.kind === 'directory' ? 'server-files.open-folder' : 'server-files.edit')}
        </Item>
        <Separator />
        <Item icon={<Icon name="icons/actions/edit" />} onSelect={() => setNaming({ kind: 'rename', entry: { name: row.name } })}>{t('server-files.rename')}</Item>
        <Item icon={<Icon name="icons/actions/delete" />} tone="danger" onSelect={() => setDeleting(row)}>{t('server-files.move-to-trash')}</Item>
      </>
    );
  };

  const rootLabel = (id: PackOverrideRoot) => packFileRoots.find((entry) => entry.id === id)!;

  return (
    <div data-vesta="server-files" data-modpack-files="">
      <header data-vesta="pane-toolbar">
        <SegmentedControl size="sm" aria-label={t('server-pack.root-label')} value={root()} onChange={(value) => go(value as PackOverrideRoot)}
          options={packFileRoots.map((entry) => ({ value: entry.id, label: `${t(entry.label)}${counts()[entry.id] ? ` · ${counts()[entry.id]}` : ''}` }))} />
        <Breadcrumbs aria-label={t('server-pack.files-location')} class="server-files-crumbs">
          <BreadcrumbItem href={!opened() && !crumbs().length ? undefined : href('')}>
            <span data-vesta="server-files-root"><Icon name="icons/content/folder" size={14} />{t('server-pack.root-folder', { name: rootLabel(root()).id })}</span>
          </BreadcrumbItem>
          <For each={crumbs()}>
            {(crumb, index) => <BreadcrumbItem href={!opened() && index() === crumbs().length - 1 ? undefined : href(crumb.path)}>{crumb.name}</BreadcrumbItem>}
          </For>
          <Show when={opened()}>{(file) => <BreadcrumbItem>{baseName(file().path)}</BreadcrumbItem>}</Show>
        </Breadcrumbs>
        <span data-vesta="server-toolbar-spacer" />
        <Show when={!opened()}>
          <Menu placement="bottom-end" trigger={(menuProps) => (
            <Button {...menuProps} size="sm" variant="outline" icon={<Icon name="icons/actions/add" />}>{t('server-files.new')}</Button>
          )}>
            <MenuItem icon={<Icon name="icons/content/file-add" />} onSelect={() => setNaming({ kind: 'file' })}>{t('server-files.new-file')}</MenuItem>
            <MenuItem icon={<Icon name="icons/content/folder" />} onSelect={() => setNaming({ kind: 'folder' })}>{t('server-files.new-folder')}</MenuItem>
          </Menu>
          <Button size="sm" variant="outline" icon={<Icon name="icons/actions/upload" />} disabled={uploading() > 0} onClick={() => picker?.click()}>{t('server-files.upload')}</Button>
        </Show>
        <input ref={(element) => { picker = element; }} type="file" multiple hidden onChange={(event) => { const list = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; void upload(list); }} />
      </header>

      <Show when={opened()} keyed fallback={
        <div ref={element => { dropElement = element; }} data-vesta="server-pane-body" class="server-files-body" data-drop-zone=""
          data-drop-target={dragging() ? 'active' : undefined} data-drop-hint={dragging() ? t('server-pack.drop-hint', { name: t(rootLabel(root()).label) }) : undefined}
          onDragOver={(event) => { if (!draggingFiles(event)) return; event.preventDefault(); event.dataTransfer!.dropEffect = 'copy'; setDragging(true); }}
          onDragLeave={(event) => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={(event) => { if (!draggingFiles(event)) return; event.preventDefault(); setDragging(false); void upload([...event.dataTransfer!.files]); }}>
          <p data-vesta="server-muted" class="modpack-root-hint"><Icon name="icons/status/info" size={13} /> {t(rootLabel(root()).hint)}</p>
          <ServerErrorNote error={error()} />
          <Show when={rows().length} fallback={
            <EmptyState variant="inline" icon="icons/content/folder" title={t('server-pack.files-empty')} description={t('server-pack.files-empty-hint')} />
          }>
            <div data-vesta="server-file-list" role="table" aria-label={t('server-pack.files-location')} data-columns="2">
              <div data-vesta="server-file-head" role="row">
                <span role="columnheader">{t('server-files.name')}</span>
                <span role="columnheader" aria-label={t('server-files.actions')} />
              </div>
              <For each={rows()} keyed={(row) => row.path}>
                {(row) => (
                  <ContextMenu trigger={(contextProps) => (
                    <div {...contextProps} data-vesta="server-file-row" role="row">
                      <button type="button" role="cell" data-vesta="server-file-open" onClick={() => open(row())}>
                        <span data-vesta="server-file-icon" data-kind={fileKind(row().path, row().kind)}><Icon name={fileIcon[fileKind(row().path, row().kind)]} /></span>
                        <span data-vesta="server-file-name">{row().name}</span>
                      </button>
                      <span role="cell">
                        <Menu placement="bottom-end" trigger={(menuProps) => (
                          <IconButton {...menuProps} variant="ghost" size="sm" tooltip={false} label={t('common.actions-for', { name: row().name })} icon={<Icon name="icons/content/ellipsis-v" />} />
                        )}>
                          {actions(row())}
                        </Menu>
                      </span>
                    </div>
                  )}>
                    {actions(row(), true)}
                  </ContextMenu>
                )}
              </For>
            </div>
          </Show>
        </div>
      }>
        {(file) => (
          <FileEditor snapshot={area.snapshot()} path={file.path} label={`${file.root}/${file.path}`} source={source(file.root)}
            onClose={() => setOpened(null)} />
        )}
      </Show>

      <Show when={naming()} keyed>
        {(request) => (
          <NameDialog snapshot={area.snapshot()} directory={directory()} siblings={rows()} request={request} perform={name}
            onClose={() => setNaming(null)}
            onDone={(path) => { setNaming(null); if (request.kind === 'file') setOpened({ root: root(), path }); }} />
        )}
      </Show>
      <Show when={deleting()} keyed>
        {(row) => (
          <DeleteDialog snapshot={area.snapshot()} path={row.path} description={t('server-pack.file-trash-description')}
            perform={(intentId) => mutate({ operation: 'trash', root: root(), path: row.path }, intentId)}
            onClose={() => setDeleting(null)} onDone={() => setDeleting(null)} />
        )}
      </Show>
    </div>
  );
}

