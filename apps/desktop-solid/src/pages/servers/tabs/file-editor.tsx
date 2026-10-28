import { Badge, Button, Dialog, IconButton, Skeleton, TextArea, toast } from '@vesta/ui';
import { Show, createEffect, createSignal, onCleanup, untrack } from 'solid-js';
import { navigate, setLeaveGuard } from '../../../app/router';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { baseName, changedLineCount, fileActions, fileIcon, fileKind, formatBytes, saveText, saveTextFile, type TextFileSource } from '../../../features/servers/files-model';
import { IntentMemo } from '../../../features/servers/model';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import {
  IDLE, protectedAccess, protectedErrorEvent, protectedErrorMessage, protectedEditReducer, protectedEditSends, protectedNotice, protectedResultEvent,
  protectedLeaveDestination, protectedSection, type ProtectedEdit, type ProtectedEditEvent,
} from '../../../features/servers/protected-edit';
import type { MessageId } from '../../../localization/messages';
import type { ServerCommandError, ServerSnapshot, TextFile } from '../../../features/servers/native';
import { ServerErrorNote } from '../parts';
import '../../library/instance/settings-tab.css';

/**
 * Text editor bound to the SHA-256 the file was read with. A save against a stale
 * validator never overwrites: it opens a compare of the server's copy and the draft.
 * `source` swaps the store (a modpack's override files); without it the server's game files are edited.
 */
export function FileEditor(props: {
  snapshot: ServerSnapshot; path: string; onClose: () => void; onDownload?: () => void;
  source?: TextFileSource; readOnly?: boolean; label?: string;
}) {
  const id = () => props.snapshot.connection.id;
  const readText = (path: string) => (props.source ? props.source.read(path) : serverCommand((client) => client.fileReadText(id(), path)));
  const [file, setFile] = createSignal<TextFile | null>(null, { name: 'server-file-editor:file' });
  const [draft, setDraft] = createSignal('', { name: 'server-file-editor:draft' });
  const [validator, setValidator] = createSignal<string | null>(null, { name: 'server-file-editor:validator' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-file-editor:error' });
  const [saving, setSaving] = createSignal(false, { name: 'server-file-editor:saving' });
  const [conflict, setConflict] = createSignal<TextFile | null>(null, { name: 'server-file-editor:conflict' });
  const [gone, setGone] = createSignal(false, { name: 'server-file-editor:gone' });
  const intents = new IntentMemo();
  /** Owners/admins editing server.properties, whitelist.json, ops.json or banned-*.json directly. */
  const raw = () => !props.source && protectedAccess(props.snapshot.capabilities, props.path) === 'raw';
  const [edit, setEdit] = createSignal<ProtectedEdit>(IDLE, { name: 'server-file-editor:protected' });
  const [rawProblem, setRawProblem] = createSignal<MessageId | null>(null, { name: 'server-file-editor:raw-problem' });
  const rawIntents = new IntentMemo();
  const now = useServersClock();
  const editable = () => {
    const current = file();
    if (!current || current.binary || current.truncated) return false;
    return props.source ? !props.readOnly : fileActions(props.snapshot.capabilities, props.path, { kind: 'file', size: current.size }).edit;
  };
  const dirty = () => !!file() && draft() !== file()!.text;
  /** Where the user tried to go with unsaved edits: a route, or `close` for the Back button. */
  const [leaving, setLeaving] = createSignal<string | null>(null, { name: 'server-file-editor:leaving' });
  let rawLeave: string | null = null;
  const saveKeys = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘S' : 'Ctrl+S';

  const load = async () => {
    setError(null);
    try {
      const read = await readText(props.path);
      setFile(read); setDraft(read.text); setValidator(read.sha256); setGone(false);
    } catch (reason) { setError(reason as ServerCommandError); }
  };
  createEffect(() => props.path, () => { void load(); }, { name: 'server-file-editor:load' });

  /** Saves `text` against `expected`; a stale validator opens the compare dialog. True once saved. */
  const save = async (text: string, expected: string | null): Promise<boolean> => {
    setSaving(true); setError(null);
    const intentId = intents.idFor({ path: props.path, text, expected });
    try {
      const outcome = props.source
        ? await saveText(props.source, props.path, text, expected, intentId)
        : await serverCommand((client) => saveTextFile(client, id(), props.path, text, expected, intentId));
      intents.settle();
      if (outcome.kind === 'saved') {
        setFile({ text, sha256: outcome.sha256, size: outcome.size, binary: false, truncated: false });
        setValidator(outcome.sha256); setConflict(null); setGone(false);
        toast.show({ title: t('server-files.saved', { name: baseName(props.path) }), tone: 'success' });
        return true;
      } else if (outcome.kind === 'conflict') setConflict(outcome.server);
      else { setGone(true); setValidator(null); }
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setError(reason as ServerCommandError);
    } finally { setSaving(false); }
    return false;
  };
  const canSave = () => dirty() && editable() && !saving() && edit().step === 'idle';
  const saveNow = () => {
    if (!canSave()) return Promise.resolve(false);
    if (raw() && validator()) { setRawProblem(null); step({ type: 'save', text: draft(), expected: validator()! }); return Promise.resolve(false); }
    return save(draft(), validator());
  };

  // ---- Raw protected documents: validate → confirm the risk → write with the token.
  /** Applies one transition and sends the request the next step needs. */
  const step = (event: ProtectedEditEvent) => {
    if (event.type === 'cancel' || event.type === 'reload' || event.type === 'failed' || event.type === 'gone') rawLeave = null;
    const next = protectedEditReducer(untrack(edit), event);
    setEdit(next);
    if (next.step === 'conflict') setConflict(next.server);
    if (next.step === 'gone') { setGone(true); setValidator(null); }
    if (protectedEditSends(next)) void send(next);
  };
  const send = async (state: ProtectedEdit) => {
    if (state.step !== 'preparing' && state.step !== 'applying') return;
    setSaving(true); setError(null);
    const intentId = rawIntents.idFor({ path: props.path, text: state.text, expected: state.expected });
    try {
      const result = await serverCommand((client) => client.fileWriteProtected(id(), props.path, state.text, state.expected,
        state.step === 'applying' ? state.token : null, intentId));
      if (result.kind === 'applied') {
        rawIntents.settle();
        setFile({ text: state.text, sha256: result.sha256, size: String(new TextEncoder().encode(state.text).length), binary: false, truncated: false });
        setValidator(result.sha256); setConflict(null); setGone(false);
        toast.show({ title: t('server-files.saved', { name: baseName(props.path) }), description: result.restartNeeded ? t('server-files.raw-restart') : undefined, tone: 'success' });
      }
      const event = protectedResultEvent(result);
      const destination = protectedLeaveDestination(rawLeave, event);
      step(event);
      if (event.type === 'applied') rawLeave = null;
      if (destination && draft() === state.text) proceed(destination);
    } catch (reason) {
      const failure = reason as ServerCommandError;
      rawIntents.settle(failure);
      const event = protectedErrorEvent(failure);
      if (event) {
        if (event.type === 'failed') { const message = protectedErrorMessage(failure, props.path); if (message) setRawProblem(message); else setError(failure); }
        if (event.type === 'expired') toast.show({ title: t('server-files.raw-expired'), tone: 'neutral' });
        step(event);
        return;
      }
      // Stale: read the server's copy so the user can compare before choosing.
      try { step({ type: 'stale', server: await readText(props.path) }); }
      catch (readError) {
        if ((readError as ServerCommandError).code === 'not_found') step({ type: 'gone' });
        else { setError(readError as ServerCommandError); step({ type: 'failed' }); }
      }
    } finally { setSaving(false); }
  };
  const confirming = () => { const current = edit(); return current.step === 'confirm' || current.step === 'applying' ? current : null; };
  const secondsLeft = () => { const current = edit(); return current.step === 'confirm' ? Math.max(0, Math.ceil((current.expiresAtMs - now()) / 1000)) : null; };
  /** The draft goes over a newer server copy (after "Overwrite with mine"). */
  const overwriting = () => { const current = confirming(); return !!current && current.expected !== file()?.sha256; };
  const discard = () => { if (file()) setDraft(file()!.text); };

  // Unsaved edits hold every way out: other routes, the Back button, and closing the window.
  // `proceed` drops the guard synchronously: the effect that would drop it runs after the navigation.
  let releaseGuard: (() => void) | undefined;
  createEffect(dirty, (isDirty) => {
    if (!isDirty) return;
    const release = setLeaveGuard((to) => { setLeaving(to); return false; });
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', unload);
    releaseGuard = () => { release(); window.removeEventListener('beforeunload', unload); };
    return () => { releaseGuard?.(); releaseGuard = undefined; };
  }, { name: 'server-file-editor:leave-guard' });
  const close = () => { if (dirty()) setLeaving('close'); else props.onClose(); };
  /** Leaves for wherever the user was headed, once the edits are saved or dropped. */
  const proceed = (to: string) => {
    releaseGuard?.();
    setLeaving(null);
    if (to === 'close') props.onClose(); else navigate(to);
  };
  const leaveDiscarding = () => { const to = leaving(); discard(); if (to) proceed(to); };
  const leaveSaving = async () => {
    const to = leaving();
    if (!to) return;
    if (raw() && canSave() && validator()) { rawLeave = to; setLeaving(null); void saveNow(); return; }
    if (await saveNow()) proceed(to); else setLeaving(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    void saveNow();
  };
  onCleanup(() => setLeaving(null));
  const discardMine = () => {
    const server = conflict();
    if (!server) return;
    setFile(server); setDraft(server.text); setValidator(server.sha256); setConflict(null);
    if (edit().step !== 'idle') step({ type: 'reload' });
  };
  const overwriteMine = () => {
    if (edit().step === 'conflict') { setConflict(null); step({ type: 'overwrite' }); }
    else void save(draft(), conflict()?.sha256 ?? null);
  };

  return (
    <div data-vesta="settings-content" class="server-file-editor" onKeyDown={onKeyDown}>
      <div data-vesta="server-file-bar">
        <IconButton size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-back" />} label={t('server-files.back-to-files')} onClick={close} />
        <span data-vesta="server-file-icon" data-kind={fileKind(props.path)}><Icon name={fileIcon[fileKind(props.path)]} /></span>
        <span data-vesta="server-file-name">{props.label ?? props.path}</span>
        <Show when={file()}>{(current) => <span data-vesta="server-file-meta">{formatBytes(current().size)}</span>}</Show>
        <Show when={file() && !editable()}><Badge size="sm" variant="soft">{t('server-files.read-only')}</Badge></Show>
        <span data-vesta="server-toolbar-spacer" />
        {/* Save lives in the bar, always in the same place, so editing never moves the page. */}
        <Show when={dirty()}>
          <span data-vesta="server-file-dirty" role="status">
            <span data-vesta="server-file-dirty-dot" aria-hidden="true" />
            {t('server-files.unsaved')}
          </span>
          <Button size="sm" variant="ghost" disabled={saving()} onClick={discard}>{t('server-files.discard')}</Button>
        </Show>
        <Show when={editable()}>
          <Button size="sm" tone="accent" disabled={!canSave()} data-tip={t('server-files.save-shortcut', { value: saveKeys })}
            onClick={() => void saveNow()}>{t('server-files.save')}</Button>
        </Show>
        <Show when={props.onDownload}>
          {(download) => <IconButton size="sm" variant="ghost" icon={<Icon name="icons/actions/download" />} label={t('server-files.download')} onClick={() => download()()} />}
        </Show>
      </div>
      <div data-vesta="server-pane-body" class="server-file-editor-body">
        <Show when={raw()}>
          <div data-vesta="server-file-raw-notice" role="note">
            <span><Icon name="icons/security/shield" size={14} /><span><strong>{t('server-files.raw-notice-title')}</strong> {t(protectedNotice(props.path))}</span></span>
            <Button size="sm" variant="outline" icon={<Icon name="icons/actions/external-link" />}
              onClick={() => transitionTo(`/servers/${id()}/settings/${protectedSection(props.path)}`)}>{t('server-files.raw-open-there')}</Button>
          </div>
        </Show>
        <Show when={rawProblem()}>{(message) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(message())}</p>}</Show>
        <ServerErrorNote error={error()} onRetry={() => void load()} />
        <Show when={file()?.truncated}><p data-vesta="server-callout" data-tone="neutral">{t('server-files.preview-only')}</p></Show>
        <Show when={gone()}><p data-vesta="server-callout" data-tone="warning">{t('server-files.deleted-on-server')}</p></Show>
        <Show when={file()} fallback={<Show when={!error()}><Skeleton height={240} /></Show>}>
          <Show when={!file()!.binary} fallback={<p data-vesta="server-muted">{t('server-files.binary')}</p>}>
            <TextArea class="server-file-textarea" aria-label={t('server-files.editor', { name: baseName(props.path) })}
              value={draft()} onChange={setDraft} readOnly={!editable()} spellcheck={false} wrap="off" />
          </Show>
        </Show>
      </div>
      <Dialog open={!!leaving() && !conflict()} onOpenChange={(open) => { if (!open) setLeaving(null); }} closeLabel={t('nav.close')}
        title={t('server-files.leave-title', { name: baseName(props.path) })}
        description={t('server-files.leave-description')}
        footer={<>
          <Button variant="ghost" onClick={leaveDiscarding}>{t('server-files.leave-discard')}</Button>
          <span data-vesta="server-toolbar-spacer" />
          <Button variant="outline" onClick={() => setLeaving(null)}>{t('server-files.keep-editing')}</Button>
          <Button tone="accent" disabled={!canSave()} onClick={() => void leaveSaving()}>{t('server-files.save')}</Button>
        </>}
      />
      <Dialog open={!!confirming()} onOpenChange={(open) => { if (!open && edit().step === 'confirm') step({ type: 'cancel' }); }} closeLabel={t('nav.close')} size="sm"
        title={t('server-files.raw-confirm-title', { name: baseName(props.path) })}
        description={t('server-files.raw-confirm-description')}
        footer={<>
          <span data-vesta="server-muted">{secondsLeft() !== null ? t('server-files.raw-confirm-expires', { count: secondsLeft()! }) : t('server-files.raw-saving')}</span>
          <span data-vesta="server-toolbar-spacer" />
          <Button variant="ghost" disabled={edit().step !== 'confirm'} onClick={() => step({ type: 'cancel' })}>{t('common.cancel')}</Button>
          <Button tone="danger" disabled={edit().step !== 'confirm'} onClick={() => step({ type: 'confirm', nowMs: Date.now() })}>
            {t(secondsLeft() === 0 ? 'server-hosting.review-again' : overwriting() ? 'server-files.raw-confirm-overwrite' : 'server-files.raw-confirm-save')}
          </Button>
        </>}
      >
        <ul data-vesta="server-file-raw-risk">
          <li>{t(protectedSection(props.path) === 'game' ? 'server-files.raw-risk-checks-game' : 'server-files.raw-risk-checks-players')}</li>
          <li>{t('server-files.raw-risk-trash')}</li>
          <li>{t('server-files.raw-risk-restart')}</li>
          <Show when={overwriting()}><li>{t('server-files.raw-risk-overwrite')}</li></Show>
        </ul>
      </Dialog>
      <Dialog open={!!conflict()} onOpenChange={(open) => { if (!open) { setConflict(null); if (edit().step === 'conflict') step({ type: 'cancel' }); } }} closeLabel={t('nav.close')} size="lg"
        title={t('server-files.conflict-title')}
        description={t('server-files.conflict-description', { name: baseName(props.path) })}
        footer={<>
          <Button variant="ghost" onClick={() => { setConflict(null); if (edit().step === 'conflict') step({ type: 'cancel' }); }}>{t('server-files.keep-editing')}</Button>
          <span data-vesta="server-toolbar-spacer" />
          <Button variant="outline" onClick={discardMine}>{t('server-files.discard-mine')}</Button>
          <Button tone="danger" disabled={saving()} onClick={overwriteMine}>{t('server-files.overwrite-mine')}</Button>
        </>}
      >
        <Show when={conflict()}>
          {(server) => (
            <>
              <p data-vesta="server-muted">{t('server-files.conflict-lines', { count: changedLineCount(server().text, draft()) })}</p>
              <div data-vesta="server-file-compare">
                <TextArea label={t('server-files.server-copy')} value={server().text} readOnly rows={14} spellcheck={false} wrap="off" class="server-file-compare-pane" />
                <TextArea label={t('server-files.my-copy')} value={draft()} readOnly rows={14} spellcheck={false} wrap="off" class="server-file-compare-pane" />
              </div>
            </>
          )}
        </Show>
      </Dialog>
    </div>
  );
}

