import { Badge, Button, Dialog, IconButton, Skeleton, TextArea, toast } from '@vesta/ui';
import { Show, createEffect, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { baseName, changedLineCount, fileActions, fileIcon, fileKind, formatBytes, saveTextFile } from '../../../features/servers/files-model';
import { IntentMemo } from '../../../features/servers/model';
import { serverCommand } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot, TextFile } from '../../../features/servers/native';
import { ServerErrorNote } from '../parts';
import '../../library/instance/settings-tab.css';

/**
 * Text editor bound to the SHA-256 the file was read with. A save against a stale
 * validator never overwrites: it opens a compare of the server's copy and the draft.
 */
export function FileEditor(props: { snapshot: ServerSnapshot; path: string; onClose: () => void; onDownload: () => void }) {
  const id = () => props.snapshot.connection.id;
  const [file, setFile] = createSignal<TextFile | null>(null, { name: 'server-file-editor:file' });
  const [draft, setDraft] = createSignal('', { name: 'server-file-editor:draft' });
  const [validator, setValidator] = createSignal<string | null>(null, { name: 'server-file-editor:validator' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-file-editor:error' });
  const [saving, setSaving] = createSignal(false, { name: 'server-file-editor:saving' });
  const [conflict, setConflict] = createSignal<TextFile | null>(null, { name: 'server-file-editor:conflict' });
  const [gone, setGone] = createSignal(false, { name: 'server-file-editor:gone' });
  const intents = new IntentMemo();
  const editable = () => {
    const current = file();
    return !!current && !current.binary && !current.truncated && fileActions(props.snapshot.capabilities, props.path, { kind: 'file', size: current.size }).edit;
  };
  const dirty = () => !!file() && draft() !== file()!.text;

  const load = async () => {
    setError(null);
    try {
      const read = await serverCommand((client) => client.fileReadText(id(), props.path));
      setFile(read); setDraft(read.text); setValidator(read.sha256); setGone(false);
    } catch (reason) { setError(reason as ServerCommandError); }
  };
  createEffect(() => props.path, () => { void load(); }, { name: 'server-file-editor:load' });

  /** Saves `text` against `expected`; a stale validator opens the compare dialog. */
  const save = async (text: string, expected: string | null) => {
    setSaving(true); setError(null);
    const intentId = intents.idFor({ path: props.path, text, expected });
    try {
      const outcome = await serverCommand((client) => saveTextFile(client, id(), props.path, text, expected, intentId));
      intents.settle();
      if (outcome.kind === 'saved') {
        setFile({ text, sha256: outcome.sha256, size: outcome.size, binary: false, truncated: false });
        setValidator(outcome.sha256); setConflict(null); setGone(false);
        toast.show({ title: t('server-files.saved', { name: baseName(props.path) }), tone: 'success' });
      } else if (outcome.kind === 'conflict') setConflict(outcome.server);
      else { setGone(true); setValidator(null); }
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setError(reason as ServerCommandError);
    } finally { setSaving(false); }
  };
  const discardMine = () => {
    const server = conflict();
    if (!server) return;
    setFile(server); setDraft(server.text); setValidator(server.sha256); setConflict(null);
  };

  return (
    <div data-vesta="settings-content" class="server-file-editor" data-dirty={dirty() ? '' : undefined}>
      <div data-vesta="server-file-bar">
        <IconButton size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-back" />} label={t('server-files.back-to-files')} onClick={props.onClose} />
        <span data-vesta="server-file-icon" data-kind={fileKind(props.path)}><Icon name={fileIcon[fileKind(props.path)]} /></span>
        <span data-vesta="server-file-name">{props.path}</span>
        <Show when={file()}>{(current) => <span data-vesta="server-file-meta">{formatBytes(current().size)}</span>}</Show>
        <Show when={file() && !editable()}><Badge size="sm" variant="soft">{t('server-files.read-only')}</Badge></Show>
        <span data-vesta="server-toolbar-spacer" />
        <IconButton size="sm" variant="ghost" icon={<Icon name="icons/actions/download" />} label={t('server-files.download')} onClick={props.onDownload} />
      </div>
      <div data-vesta="server-pane-body" class="server-file-editor-body">
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
      <Show when={dirty()}>
        <div data-vesta="settings-savebar" role="region" aria-label={t('server-files.unsaved')}>
          <span data-vesta="settings-savebar-dot" />
          <span>{t('server-files.unsaved')}</span>
          <Button size="sm" variant="ghost" disabled={saving()} onClick={() => setDraft(file()!.text)}>{t('server-files.discard')}</Button>
          <Button size="sm" tone="accent" disabled={saving() || !editable()} onClick={() => void save(draft(), validator())}>{t('server-files.save')}</Button>
        </div>
      </Show>
      <Dialog open={!!conflict()} onOpenChange={(open) => { if (!open) setConflict(null); }} closeLabel={t('nav.close')} size="lg"
        title={t('server-files.conflict-title')}
        description={t('server-files.conflict-description', { name: baseName(props.path) })}
        footer={<>
          <Button variant="ghost" onClick={() => setConflict(null)}>{t('server-files.keep-editing')}</Button>
          <span data-vesta="server-toolbar-spacer" />
          <Button variant="outline" onClick={discardMine}>{t('server-files.discard-mine')}</Button>
          <Button tone="danger" disabled={saving()} onClick={() => void save(draft(), conflict()?.sha256 ?? null)}>{t('server-files.overwrite-mine')}</Button>
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

