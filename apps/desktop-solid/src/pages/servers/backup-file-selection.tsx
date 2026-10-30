import { Button } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import { FileTreePicker, type TreeEntry } from '../../components/file-tree-picker';
import { serverCommand } from '../../features/servers/store';
import type { ServerCommandError } from '../../features/servers/native';
import { t } from '../../localization';
import { ServerErrorNote } from './parts';
export function BackupFileSelection(props: { connectionId: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const [entries, setEntries] = createSignal<TreeEntry[] | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<ServerCommandError | null>(null);
  const open = async () => {
    setBusy(true); setError(null);
    try {
      const result: TreeEntry[] = [];
      const visit = async (path: string) => {
        let cursor: string | null = null;
        do {
          const page = await serverCommand(api => api.filesList(props.connectionId, path, cursor));
          for (const item of page.items) {
            const full = path ? path + '/' + item.name : item.name;
            result.push({ path: full, directory: item.kind === 'directory' });
            if (item.kind === 'directory') await visit(full);
          }
          cursor = page.nextCursor;
        } while (cursor);
      };
      await visit(''); setEntries(result);
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  return <div>
    <Button size="sm" variant="outline" disabled={busy() || props.disabled} onClick={() => void open()}>{t('management.export-files')}</Button>
    <ServerErrorNote error={error()} onRetry={() => void open()} />
    <Show when={entries()}>{items => <FileTreePicker title={t('servers.backup-setup.include')} entries={items()} selected={props.value.split('\n').filter(Boolean)} onClose={() => setEntries(null)} onApply={paths => {
      const compact = [...paths];
      // A fully selected folder stays a folder include, so future files are backed up too.
      for (const item of items().filter(item => item.directory).sort((a, b) => b.path.length - a.path.length)) {
        const children = items().filter(child => !child.directory && child.path.startsWith(item.path + '/'));
        if (children.length && children.every(child => paths.includes(child.path))) {
          for (let i = compact.length - 1; i >= 0; i--) if (compact[i].startsWith(item.path + '/')) compact.splice(i, 1);
          compact.push(item.path);
        }
      }
      props.onChange(compact.join('\n')); setEntries(null);
    }} />}</Show>
  </div>;
}
