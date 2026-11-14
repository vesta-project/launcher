// The Import way of adding a server: pick a folder on the machine, from the ones found for
// you or by browsing. The browser's path bar doubles as an address bar for a known path.
// A folder is only handed on once Vesta Server can read it and it is a server.
import { Badge, Button, IconButton } from '@vesta/ui';
import { For, Match, Show, Switch, createMemo, createSignal, createUniqueId, onSettled, untrack } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { formatBytes } from '../../features/settings/storage-model';
import { toServerError } from '../../features/servers/errors';
import { folderVerdict } from '../../features/servers/host-add-model';
import {
  folderName, folderUse, importProblem, importRootCommand, isDriveRoot, joinPath, lastSegment, locate, normalisePath, readCandidates, readFolderCheck,
  splitPath, type CheckOutcome, type FolderUse, type ImportCandidate,
} from '../../features/servers/host-model';
import { hostCommand } from '../../features/servers/hosts-store';
import type { Folder, FolderRoot } from '../../features/servers/native-hosts';
import type { ServerCommandError } from '../../features/servers/native';
import { CommandLine, Working } from './vesta-parts';
import './vesta-server.css';

/** A folder on the machine that the person picked, with the name a server made from it gets. */
/** `granted` means Vesta Server could only just read it, after a Check again. */
export interface Picked { token: string; displayPath: string; name: string; granted?: boolean }

// ------------------------------------------------------------------ permission

/** A folder Vesta Server can't read: why, the exact command for the machine, and Check again. */
export function PermissionHelp(props: { name: string; machine: string; command: string; checking: boolean; still: boolean; onCheck: () => void }) {
  return (
    <div data-vesta="server-callout" data-tone="warning" role="group">
      <p>{t('vesta-server.import.permission', { path: props.name, name: props.machine })}</p>
      <CommandLine command={props.command} />
      <div data-vesta="vesta-callout-actions">
        <Show when={props.still}><span role="status">{t('vesta-server.import.permission-still')}</span></Show>
        <Button size="sm" disabled={props.checking} icon={<Icon name="icons/actions/refresh" />} onClick={() => props.onCheck()}>
          {props.checking ? t('vesta-server.import.checking-path') : t('vesta-server.import.check-again')}
        </Button>
      </div>
    </div>
  );
}

/** A folder check that can fail on older machines without the check route. */
export async function checkPath(hostId: string, path: string): Promise<CheckOutcome | { kind: 'unsupported' } | { kind: 'error'; error: ServerCommandError }> {
  try {
    return readFolderCheck(await hostCommand((client) => client.folderCheck(hostId, path)), path);
  } catch (reason) {
    const error = toServerError(reason);
    return error.code === 'not_found' || error.code === 'unsupported' ? { kind: 'unsupported' } : { kind: 'error', error };
  }
}

// ------------------------------------------------------------------ folder step

export function ImportFolderStep(props: { hostId: string; machine: string; onPick: (folder: Picked) => void }) {
  const [candidates, setCandidates] = createSignal<ImportCandidate[] | null>(null, { name: 'host-import:candidates' });
  const [truncated, setTruncated] = createSignal(false, { name: 'host-import:truncated' });
  const [roots, setRoots] = createSignal<FolderRoot[] | null>(null, { name: 'host-import:roots' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'host-import:error' });

  const load = async () => {
    setError(null);
    const [found, shared] = await Promise.allSettled([
      hostCommand((client) => client.importCandidates(props.hostId)),
      hostCommand((client) => client.folderRoots(props.hostId)),
    ]);
    if (found.status === 'fulfilled') {
      const read = readCandidates(found.value);
      setCandidates(read.candidates);
      setTruncated(read.truncated);
    } else { setCandidates([]); setError(toServerError(found.reason)); }
    if (shared.status === 'fulfilled') setRoots(shared.value.roots);
    else { setRoots([]); if (found.status === 'fulfilled') setError(toServerError(shared.reason)); }
  };
  onSettled(() => void load());

  const unavailable = () => error()?.reason === 'imports_unavailable' || error()?.code === 'unsupported';

  return (
    <div data-vesta="add-import">
      <Show when={unavailable()}>
        <p data-vesta="server-callout" data-tone="warning">{t('vesta-server.import.unavailable')}</p>
      </Show>
      <Show when={!unavailable()}>
        <Show when={error()}>
          {(problem) => (
            <div data-vesta="server-callout" data-tone="danger" role="alert">
              <p>{t(importProblem(problem()))}</p>
              <Button size="sm" onClick={() => void load()}>{t('common.retry')}</Button>
            </div>
          )}
        </Show>

        <Show when={candidates()?.length}>
          <FoundList hostId={props.hostId} machine={props.machine} candidates={candidates()!} truncated={truncated()} onPick={props.onPick} onReload={() => void load()} />
        </Show>

        <Show when={roots()} fallback={<Working label={t('vesta-server.import.opening')} />}>
          {(list) => <FolderBrowser hostId={props.hostId} machine={props.machine} roots={list()} onPick={props.onPick} />}
        </Show>
      </Show>
    </div>
  );
}

/** Likely servers the machine found, one compact row each, for a one click choice. */
function FoundList(props: { hostId: string; machine: string; candidates: ImportCandidate[]; truncated: boolean; onPick: (folder: Picked) => void; onReload: () => void }) {
  const [open, setOpen] = createSignal<string | null>(null, { name: 'host-import:found-open' });
  const [checking, setChecking] = createSignal(false, { name: 'host-import:found-checking' });
  const [still, setStill] = createSignal(false, { name: 'host-import:found-still' });

  const recheck = async (candidate: ImportCandidate) => {
    setChecking(true);
    setStill(false);
    const outcome = await checkPath(props.hostId, candidate.displayPath);
    setChecking(false);
    if (outcome.kind === 'ok') props.onPick({ token: outcome.token, displayPath: outcome.path, name: lastSegment(outcome.path), granted: true });
    else if (outcome.kind === 'unsupported') props.onReload();
    else setStill(true);
  };
  const toggle = (candidate: ImportCandidate) => {
    setStill(false);
    setOpen((current) => (current === candidate.candidateId ? null : candidate.candidateId));
  };

  return (
    <section data-vesta="vesta-section" aria-labelledby="vesta-found-heading">
      <h2 id="vesta-found-heading">{t('vesta-server.import.found', { name: props.machine })}</h2>
      <ul data-vesta="vesta-found" data-compact>
        <For each={props.candidates} keyed={(candidate) => candidate.candidateId}>
          {(candidate) => (
            <li>
              <button type="button" data-vesta="vesta-machine" data-locked={candidate().folderToken ? undefined : ''}
                aria-expanded={candidate().folderToken ? undefined : open() === candidate().candidateId ? 'true' : 'false'}
                onClick={() => {
                  const picked = candidate();
                  if (picked.folderToken) props.onPick({ token: picked.folderToken, displayPath: picked.displayPath, name: picked.label });
                  else toggle(picked);
                }}>
                <Icon name={candidate().folderToken ? 'icons/content/folder' : 'icons/security/folder-lock'} size={16} />
                <span data-vesta="vesta-machine-text">
                  <strong>{candidate().label}</strong>
                  <span>{candidate().displayPath}</span>
                </span>
                <span data-vesta="vesta-found-meta">
                  <Show when={!candidate().folderToken}><Badge tone="warning" size="sm">{t('vesta-server.import.needs-permission')}</Badge></Show>
                  <Show when={candidate().software}>{(software) => <Badge size="sm">{software()}</Badge>}</Show>
                  <Show when={candidate().bytes}>{(bytes) => <span data-vesta="vesta-found-size">{formatBytes(bytes())}</span>}</Show>
                </span>
                <Icon name={candidate().folderToken ? 'icons/controls/chevron-right' : open() === candidate().candidateId ? 'icons/controls/chevron-up' : 'icons/controls/chevron-down'} size={14} />
              </button>
              <Show when={!candidate().folderToken && open() === candidate().candidateId && candidate().command}>
                {(command) => (
                  <PermissionHelp name={candidate().displayPath} machine={props.machine} command={command()} checking={checking()} still={still()}
                    onCheck={() => void recheck(candidate())} />
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={props.truncated}><p data-vesta="server-muted">{t('vesta-server.warning.truncated')}</p></Show>
    </section>
  );
}

// ------------------------------------------------------------------ folder browser

interface Place { rootId: string | null; path: string; token: string; entries: Folder[]; cursor: string | null; looksLikeServer?: boolean }
type View = { kind: 'top' } | { kind: 'folder'; place: Place };
interface Locked { name: string; path: string; command: string }

/** Why a typed path didn't open, said once under the bar. */
const typedProblem = (outcome: Exclude<Awaited<ReturnType<typeof checkPath>>, { kind: 'ok' | 'permission' }> | { kind: 'invalid' }): MessageId => {
  if (outcome.kind === 'problem') return outcome.message;
  if (outcome.kind === 'invalid') return 'vesta-server.import.path-invalid';
  if (outcome.kind === 'unsupported') return 'vesta-server.import.path-unsupported';
  return importProblem(outcome.error);
};

/**
 * The machine's folders from the top: a path trail, Up, and the folders here. Likely servers
 * carry a badge; folders Vesta Server can't read show a lock and how to fix that. Clicking the
 * trail (or Ctrl+L) turns it into a box to type or paste a path, like a file manager.
 */
function FolderBrowser(props: { hostId: string; machine: string; roots: FolderRoot[]; onPick: (folder: Picked) => void }) {
  const drives = createMemo(() => props.roots.filter((root) => isDriveRoot(root.displayPath)), { name: 'host-import:drives' });
  const shortcuts = createMemo(() => props.roots.filter((root) => !isDriveRoot(root.displayPath)), { name: 'host-import:shortcuts' });
  // The top of the machine: one drive opens straight away, several (or none, on older machines) list here.
  const topRoots = () => (drives().length ? drives() : shortcuts());
  const single = () => (drives().length === 1 ? drives()[0] : undefined);

  const [view, setView] = createSignal<View>({ kind: 'top' }, { name: 'host-import:view' });
  // With one drive the browser opens it right away, so it starts out loading.
  const [loading, setLoading] = createSignal(untrack(() => props.roots.filter((root) => isDriveRoot(root.displayPath)).length === 1), { name: 'host-import:browsing' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'host-import:browse-error' });
  const [locked, setLocked] = createSignal<Locked | null>(null, { name: 'host-import:locked' });
  const [lockChecking, setLockChecking] = createSignal(false, { name: 'host-import:lock-checking' });
  const [lockStill, setLockStill] = createSignal(false, { name: 'host-import:lock-still' });
  const [inspected, setInspected] = createSignal<{ token: string; use: FolderUse | 'checking' } | null>(null, { name: 'host-import:inspected' });
  const [active, setActive] = createSignal(0, { name: 'host-import:active-row' });
  // The path bar as a text box: what is typed, whether it is being checked, and why it didn't open.
  const [typing, setTyping] = createSignal<string | null>(null, { name: 'host-import:typing' });
  const [typedChecking, setTypedChecking] = createSignal(false, { name: 'host-import:typed-checking' });
  const [typedError, setTypedError] = createSignal<MessageId | null>(null, { name: 'host-import:typed-error' });
  const noteId = createUniqueId();
  const typedNoteId = createUniqueId();
  let list: HTMLUListElement | undefined;
  let focusAfter = false;

  const place = () => { const current = view(); return current.kind === 'folder' ? current.place : null; };

  /** Ask the machine only when the listing didn't already say. */
  const inspect = async (target: Place) => {
    const token = target.token;
    setInspected({ token, use: 'checking' });
    try {
      const report = await hostCommand((client) => client.importInspect(props.hostId, token));
      const verdict = folderVerdict(report, target.path, target.entries);
      if (verdict.kind === 'unreadable') {
        setInspected({ token, use: { usable: false, reason: 'server-add.import.unreadable' } });
        setLocked({ name: folderName(target.path), path: target.path, command: verdict.command });
      } else {
        setInspected({ token, use: verdict.kind === 'server' ? { usable: true } : { usable: false, reason: verdict.reason } });
      }
    } catch {
      // Older machines can't inspect here. The folder is checked again before review.
      setInspected({ token, use: { usable: true } });
    }
  };

  const show = (next: View) => {
    setView(next);
    setLocked(null);
    setActive(0);
    if (next.kind === 'folder' && folderUse({ top: isDriveRoot(next.place.path), looksLikeServer: next.place.looksLikeServer }) === null) void inspect(next.place);
    if (focusAfter) {
      focusAfter = false;
      requestAnimationFrame(() => list?.querySelector<HTMLElement>('[data-vesta="vesta-folder"]')?.focus());
    }
  };

  const listFolder = async (target: Omit<Place, 'entries' | 'cursor'>) => {
    const page = await hostCommand((client) => client.folderList(props.hostId, target.token, null));
    show({ kind: 'folder', place: { ...target, path: page.displayPath || target.path, entries: page.entries, cursor: page.nextCursor } });
  };

  const run = async (work: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try { await work(); }
    catch (reason) { setError(toServerError(reason)); }
    finally { setLoading(false); }
  };

  const goTo = (path: string, hint: { token?: string; looksLikeServer?: boolean } = {}) => run(async () => {
    const found = locate(path, props.roots, place()?.rootId);
    if (found) {
      const resolved = await hostCommand((client) => client.folderResolve(props.hostId, found.root.rootId, found.segments.join('/')));
      await listFolder({ rootId: found.root.rootId, path: resolved.displayPath, token: resolved.folderToken, looksLikeServer: hint.looksLikeServer });
    } else if (hint.token) {
      await listFolder({ rootId: null, path, token: hint.token, looksLikeServer: hint.looksLikeServer });
    } else {
      show({ kind: 'top' });
    }
  });

  const home = () => {
    const only = single();
    if (only) void goTo(only.displayPath);
    else show({ kind: 'top' });
  };
  onSettled(home);

  const enter = (entry: Folder) => {
    const current = place();
    if (!current) return;
    const here = splitPath(current.path);
    const path = joinPath(here.root, [...here.parts, entry.name]);
    if (!entry.readable || !entry.folderToken) {
      focusAfter = false;
      setLockStill(false);
      setLocked((open) => (open?.path === path ? null : { name: entry.name, path, command: entry.remediationCommand ?? importRootCommand(path) }));
      return;
    }
    void run(() => listFolder({ rootId: current.rootId, path, token: entry.folderToken!, looksLikeServer: entry.looksLikeServer }));
  };
  const openRoot = (root: FolderRoot) => void goTo(root.displayPath);

  const parent = () => {
    const current = place();
    if (!current) return null;
    const split = splitPath(current.path);
    return split.parts.length ? joinPath(split.root, split.parts.slice(0, -1)) : null;
  };
  const canGoUp = () => view().kind === 'folder' && (parent() !== null || !single());
  const up = () => {
    const target = parent();
    if (target !== null && locate(target, props.roots)) void goTo(target);
    else show({ kind: 'top' });
  };

  const more = () => {
    const current = place();
    if (!current?.cursor) return;
    void run(async () => {
      const page = await hostCommand((client) => client.folderList(props.hostId, current.token, current.cursor));
      setView({ kind: 'folder', place: { ...current, entries: [...current.entries, ...page.entries], cursor: page.nextCursor } });
    });
  };

  const recheckLocked = async () => {
    const target = locked();
    if (!target) return;
    setLockChecking(true);
    setLockStill(false);
    const outcome = await checkPath(props.hostId, target.path);
    setLockChecking(false);
    if (outcome.kind === 'ok') { await goTo(outcome.path, { token: outcome.token }); return; }
    if (outcome.kind === 'unsupported') {
      // Older machines: read this folder again and open the locked one if it can be read now.
      const current = place();
      if (!current) return;
      await run(() => listFolder({ rootId: current.rootId, path: current.path, token: current.token, looksLikeServer: current.looksLikeServer }));
      const entry = place()?.entries.find((candidate) => candidate.name === target.name);
      if (entry?.readable && entry.folderToken) enter(entry);
      else { setLocked(target); setLockStill(true); }
      return;
    }
    setLockStill(true);
  };

  // ---------------------------------------------------------------- the path bar as an address bar

  const startTyping = () => {
    if (typing() !== null) return;
    setTypedError(null);
    setTyping(place()?.path ?? '');
  };
  const stopTyping = () => { setTyping(null); setTypedError(null); };
  const openTyped = async (event: Event) => {
    event.preventDefault();
    const path = normalisePath(typing() ?? '');
    if (!path) { setTypedError('vesta-server.import.path-invalid'); return; }
    setTypedChecking(true);
    setTypedError(null);
    const outcome = await checkPath(props.hostId, path);
    setTypedChecking(false);
    if (outcome.kind === 'ok') {
      stopTyping();
      focusAfter = true;
      await goTo(outcome.path, { token: outcome.token });
    } else if (outcome.kind === 'permission') {
      stopTyping();
      setLockStill(false);
      setLocked({ name: folderName(outcome.path), path: outcome.path, command: outcome.command });
    } else {
      setTypedError(typedProblem(outcome));
    }
  };
  const onBrowserKey = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); startTyping(); }
  };

  /** The open folder: usable, why not, or still being checked. */
  const use = (): FolderUse | 'checking' => {
    const current = place();
    if (!current) return { usable: false, reason: 'vesta-server.import.why-top' };
    const known = folderUse({ top: isDriveRoot(current.path), looksLikeServer: current.looksLikeServer });
    if (known) return known;
    const asked = inspected();
    return asked?.token === current.token ? asked.use : 'checking';
  };
  const usable = () => { const current = use(); return current !== 'checking' && current.usable; };

  const crumbs = () => {
    const current = place();
    if (!current) return [];
    const split = splitPath(current.path);
    return split.parts.map((name, index) => ({ name, path: joinPath(split.root, split.parts.slice(0, index + 1)) }));
  };
  const driveLabel = () => splitPath(place()?.path ?? '/').root;

  const rows = () => [...(list?.querySelectorAll<HTMLElement>('[data-vesta="vesta-folder"]') ?? [])];
  const onListKey = (event: KeyboardEvent) => {
    const all = rows();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => { event.preventDefault(); all[Math.max(0, Math.min(index, all.length - 1))]?.focus(); };
    switch (event.key) {
      case 'ArrowDown': return move(at + 1);
      case 'ArrowUp':
        if (event.altKey) { event.preventDefault(); if (canGoUp()) { focusAfter = true; up(); } return; }
        return move(at - 1);
      case 'Home': return move(0);
      case 'End': return move(all.length - 1);
      case 'Backspace':
      case 'ArrowLeft':
        if (canGoUp()) { event.preventDefault(); focusAfter = true; up(); }
        return;
    }
  };

  return (
    <div data-vesta="vesta-browser" aria-busy={loading() ? 'true' : undefined} onKeyDown={onBrowserKey}>
      <Show when={shortcuts().length > 0 && drives().length > 0}>
        <div data-vesta="vesta-shortcuts" role="group" aria-label={t('vesta-server.import.shortcuts')}>
          <For each={shortcuts()} keyed={(root) => root.rootId}>
            {(root) => (
              <button type="button" data-vesta="vesta-shortcut" title={root().displayPath} disabled={!root().readable || loading()} onClick={() => openRoot(root())}>
                <Icon name="icons/content/folder" size={14} />
                <strong>{folderName(root().displayPath)}</strong>
                <span>{root().displayPath}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div data-vesta="vesta-browser-frame">
        <Show when={typing() !== null} fallback={
          <div data-vesta="vesta-browser-bar">
            {/* Clicking the empty part of the trail starts typing a path. */}
            <nav data-vesta="breadcrumbs" aria-label={t('vesta-server.import.trail')}
              onClick={(event) => { if (!(event.target as HTMLElement).closest('button')) startTyping(); }}>
              <ol data-vesta="breadcrumb-list">
                <li data-vesta="breadcrumb-item">
                  <Show when={crumbs().length > 0 || (view().kind === 'folder' && !single())} fallback={
                    <span data-vesta="breadcrumb-link" data-current aria-current="location"><Icon name="icons/content/server" size={14} />{props.machine}</span>
                  }>
                    <button type="button" data-vesta="breadcrumb-link" disabled={loading()} onClick={() => (single() ? void goTo(single()!.displayPath) : show({ kind: 'top' }))}>
                      <Icon name="icons/content/server" size={14} />{props.machine}
                    </button>
                    <span data-vesta="breadcrumb-separator" aria-hidden="true"><Icon name="icons/controls/chevron-right" size={12} /></span>
                  </Show>
                </li>
                <Show when={place() && !single()}>
                  <li data-vesta="breadcrumb-item">
                    <Show when={crumbs().length > 0} fallback={<span data-vesta="breadcrumb-link" data-current aria-current="location">{driveLabel()}</span>}>
                      <button type="button" data-vesta="breadcrumb-link" disabled={loading()} onClick={() => void goTo(driveLabel())}>{driveLabel()}</button>
                      <span data-vesta="breadcrumb-separator" aria-hidden="true"><Icon name="icons/controls/chevron-right" size={12} /></span>
                    </Show>
                  </li>
                </Show>
                <For each={crumbs()}>
                  {(crumb, index) => (
                    <li data-vesta="breadcrumb-item">
                      <Show when={index() < crumbs().length - 1} fallback={<span data-vesta="breadcrumb-link" data-current aria-current="location">{crumb.name}</span>}>
                        <button type="button" data-vesta="breadcrumb-link" disabled={loading()} onClick={() => void goTo(crumb.path)}>{crumb.name}</button>
                        <span data-vesta="breadcrumb-separator" aria-hidden="true"><Icon name="icons/controls/chevron-right" size={12} /></span>
                      </Show>
                    </li>
                  )}
                </For>
              </ol>
            </nav>
            <div data-vesta="vesta-browser-bar-actions">
              <IconButton size="sm" variant="ghost" label={t('vesta-server.import.type-path')} icon={<Icon name="icons/actions/edit" />} disabled={loading()} onClick={startTyping} />
              <Button size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-up" />} disabled={loading() || !canGoUp()} onClick={up}>{t('vesta-server.import.up')}</Button>
            </div>
          </div>
        }>
          <div data-vesta="vesta-path-bar">
            <form data-vesta="vesta-browser-bar" data-typing onSubmit={(event) => void openTyped(event)}>
              <Icon name="icons/content/server" size={14} />
              <input data-vesta="vesta-path-input" type="text" value={typing() ?? ''} spellcheck={false} autocomplete="off"
                aria-label={t('vesta-server.import.type-path')} aria-invalid={typedError() ? 'true' : undefined} aria-describedby={typedError() ? typedNoteId : undefined}
                ref={(element) => requestAnimationFrame(() => { element.focus(); element.select(); })}
                onInput={(event) => { setTyping(event.currentTarget.value); setTypedError(null); }}
                onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopTyping(); } }}
                onBlur={(event) => { if (!typedChecking() && !event.currentTarget.form?.contains(event.relatedTarget as Node | null)) stopTyping(); }} />
              <Button size="sm" variant="ghost" type="submit" disabled={typedChecking()}>{typedChecking() ? t('vesta-server.import.checking-path') : t('vesta-server.import.go')}</Button>
            </form>
            <Show when={typedError()}>
              {(message) => <p id={typedNoteId} data-vesta="vesta-browser-note" role="alert">{t(message(), { name: props.machine })}</p>}
            </Show>
          </div>
        </Show>

        <Show when={!loading() || view().kind === 'folder'} fallback={<div data-vesta="vesta-browser-wait"><Working label={t('vesta-server.import.opening')} /></div>}>
          <Switch>
            <Match when={view().kind === 'top'}>
              <ul ref={(element) => (list = element)} data-vesta="vesta-folders" aria-label={t('vesta-server.import.folders', { name: props.machine })} onKeyDown={onListKey}>
                <For each={topRoots()} keyed={(root) => root.rootId} fallback={<li><p data-vesta="vesta-folders-empty">{t('vesta-server.import.no-roots', { name: props.machine })}</p></li>}>
                  {(root, index) => (
                    <li>
                      <button type="button" data-vesta="vesta-folder" tabindex={index() === active() ? 0 : -1} disabled={!root().readable}
                        onFocus={() => setActive(index())} onClick={() => openRoot(root())}>
                        <Icon name={isDriveRoot(root().displayPath) ? 'icons/content/storage' : 'icons/content/folder'} size={16} />
                        <span data-vesta="vesta-folder-name">{folderName(root().displayPath)}</span>
                        <Show when={!isDriveRoot(root().displayPath)}><span data-vesta="vesta-folder-path">{root().displayPath}</span></Show>
                        <Icon name="icons/controls/chevron-right" size={14} />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Match>
            <Match when={place()}>
              {(current) => (
                <ul ref={(element) => (list = element)} data-vesta="vesta-folders" aria-label={t('vesta-server.import.folders', { name: folderName(current().path) })}
                  data-loading={loading() ? '' : undefined} onKeyDown={onListKey}>
                  <For each={current().entries} keyed={(entry) => entry.name} fallback={<li><p data-vesta="vesta-folders-empty">{t('vesta-server.import.empty-folder')}</p></li>}>
                    {(entry, index) => (
                      <li>
                        <button type="button" data-vesta="vesta-folder" data-locked={entry().readable ? undefined : ''}
                          tabindex={index() === active() ? 0 : -1} aria-disabled={loading() ? 'true' : undefined}
                          aria-expanded={entry().readable ? undefined : locked()?.name === entry().name ? 'true' : 'false'}
                          onFocus={() => setActive(index())}
                          onClick={() => { if (!loading()) { focusAfter = true; enter(entry()); } }}>
                          <Icon name={entry().readable ? 'icons/content/folder' : 'icons/security/folder-lock'} size={16} />
                          <span data-vesta="vesta-folder-name">{entry().name}</span>
                          <Show when={entry().looksLikeServer}><Badge tone="accent" size="sm">{t('vesta-server.import.server-badge')}</Badge></Show>
                          <Show when={!entry().readable}><Badge tone="warning" size="sm">{t('vesta-server.import.needs-permission')}</Badge></Show>
                          <Icon name="icons/controls/chevron-right" size={14} />
                        </button>
                      </li>
                    )}
                  </For>
                  <Show when={current().cursor}>
                    <li><Button size="sm" variant="ghost" disabled={loading()} onClick={more}>{t('vesta-server.import.more')}</Button></li>
                  </Show>
                </ul>
              )}
            </Match>
          </Switch>
        </Show>

        <Show when={locked()}>
          {(target) => (
            <div data-vesta="vesta-browser-locked">
              <PermissionHelp name={target().path} machine={props.machine} command={target().command} checking={lockChecking()} still={lockStill()}
                onCheck={() => void recheckLocked()} />
            </div>
          )}
        </Show>

        <Show when={error()}>
          {(problem) => (
            <div data-vesta="vesta-browser-locked">
              <div data-vesta="server-callout" data-tone="danger" role="alert">
                <p>{t(importProblem(problem()))}</p>
                <Button size="sm" onClick={home}>{t('common.retry')}</Button>
              </div>
            </div>
          )}
        </Show>

        {/* Inside a folder only: one line on why it can't be used yet, and the one way on. */}
        <Show when={place() && !isDriveRoot(place()!.path)}>
          <div data-vesta="vesta-use">
            <p id={noteId} data-vesta="vesta-note" aria-live="polite">
              <Switch>
                <Match when={use() === 'checking'}>
                  <span data-vesta="vesta-spinner" aria-hidden="true" />{t('vesta-server.import.folder-checking')}
                </Match>
                <Match when={!usable() && (use() as Extract<FolderUse, { usable: false }>)}>
                  {(why) => <span>{t(why().reason)}</span>}
                </Match>
              </Switch>
            </p>
            <Button tone="accent" disabled={loading() || !usable()} aria-describedby={noteId}
              onClick={() => { const current = place(); if (current) props.onPick({ token: current.token, displayPath: current.path, name: lastSegment(current.path) }); }}>
              {t('vesta-server.import.use-folder')}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}
