import { Button, Dialog, Select, TextField, TextArea } from '@vesta/ui';
import { invoke } from '@tauri-apps/api/core';
import { createSignal, Show } from 'solid-js';
import { nativeInstances, nativeRecord, performNative, reportInstanceError } from './native-service';
import { FileTreePicker } from '../../components/file-tree-picker';
import { t } from '../../localization';

interface ExportCandidate { path: string; size: number; isMod: boolean; [key: string]: unknown }
const [request, setRequest] = createSignal<{ id: string; candidates: ExportCandidate[] }>();
export const requestNativeExport = (id: string) => {
  if (import.meta.env.DEV && !nativeInstances) {
    setRequest({ id, candidates: [ { path: 'mods/sodium.jar', size: 1800000, isMod: true }, { path: 'config/sodium-options.json', size: 2048, isMod: false }, { path: 'config/iris.properties', size: 512, isMod: false }, { path: 'options.txt', size: 4096, isMod: false } ] });
    return Promise.resolve(true);
  }
  return performNative(id, async () => {
  const candidates = await invoke<ExportCandidate[]>('list_export_candidates', { instanceId: Number(id) });
  setRequest({ id, candidates });
  });
};
/** Explicit file selection and destination precede the existing export task. */
export function NativeExportDialog() {
  const [filesOpen, setFilesOpen] = createSignal(false);
  const [description, setDescription] = createSignal('');
  const [packName, setPackName] = createSignal('');
  const [selection, setSelected] = createSignal<string[] | null>(null);
  const selected = () => selection() ?? request()?.candidates.filter(item => item.size > 0 && !item.path.startsWith('backups/')).map(item => item.path) ?? [];
  const [format, setFormat] = createSignal('modrinth');
  const [version, setVersion] = createSignal('1.0.0');
  const [author, setAuthor] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const close = () => { setRequest(undefined); setSelected(null); setFilesOpen(false); setPackName(''); };
  const exportPack = async () => {
    const current = request(); if (!current || busy()) return;
    setBusy(true);
    try {
      const record = nativeRecord(current.id); if (!record) return;
      const extension = format() === 'modrinth' ? 'mrpack' : 'zip';
      const { save } = await import('@tauri-apps/plugin-dialog');
      const outputPath = await save({ defaultPath: `${record.name}.${extension}`, filters: [{ name: 'Modpack', extensions: [extension] }] });
      if (!outputPath) return;
      const exportFormat = format(), exportVersion = version().trim(), exportAuthor = author().trim();
      const selections = current.candidates.filter((item) => selected().includes(item.path));
      const saved = await performNative(current.id, () => invoke('export_instance_to_modpack', {
        instanceId: Number(current.id), outputPath, formatStr: exportFormat,
        selections,
        modpackName: packName().trim() || record.name, version: exportVersion, author: exportAuthor, description: description(),
      }));
      if (saved) close();
    } catch (reason) { reportInstanceError(reason); }
    finally { setBusy(false); }
  };
  return <Show when={request()}>{current => <>
    <Dialog closeLabel={t('nav.close')} title={t('instance-settings.export')} open={!filesOpen()} onOpenChange={(open) => { if (!open && !busy()) close(); }}
      footer={<><Button variant="ghost" disabled={busy()} onClick={close}>{t('common.cancel')}</Button><Button variant="outline" onClick={() => setFilesOpen(true)}>{t('management.export-files')}</Button><Button tone="accent" disabled={busy() || !version().trim() || !nativeInstances} onClick={() => void exportPack()}>{t('instance-settings.export-action')}</Button></>}>
      <div data-vesta="export-metadata">
        <Select label={t('management.export-format')} value={format()} onChange={setFormat} options={[{ value: 'modrinth', label: 'Modrinth' }, { value: 'curseforge', label: 'CurseForge' }]} />
        <TextField label={t('management.name')} value={packName() || nativeRecord(current().id)?.name || 'Riverside client'} onChange={setPackName} />
        <TextField label={t('management.export-version')} value={version()} onChange={setVersion} />
        <TextField label={t('management.export-author')} value={author()} onChange={setAuthor} />
        <TextArea label={t('management.export-description')} value={description()} onChange={setDescription} />
        <span>{t('management.export-selected', { count: selected().length })}</span>
      </div>
    </Dialog>
    <Show when={filesOpen()}><FileTreePicker title={t('management.export-files')} entries={current().candidates} selected={selected()} onClose={() => setFilesOpen(false)} onApply={paths => { setSelected(paths); setFilesOpen(false); }} /></Show>
  </>}</Show>;
}
