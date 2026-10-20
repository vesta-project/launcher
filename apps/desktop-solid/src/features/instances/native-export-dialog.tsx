import { Button, Checkbox, Dialog, Select, TextField } from '@vesta/ui';
import { invoke } from '@tauri-apps/api/core';
import { createSignal, For, Show } from 'solid-js';
import { nativeRecord, performNative, reportInstanceError } from './native-service';
import { t } from '../../localization';

interface ExportCandidate { path: string; size: number; isMod: boolean; [key: string]: unknown }
const [request, setRequest] = createSignal<{ id: string; candidates: ExportCandidate[] }>();
export const requestNativeExport = (id: string) => performNative(id, async () => {
  const candidates = await invoke<ExportCandidate[]>('list_export_candidates', { instanceId: Number(id) });
  setRequest({ id, candidates });
});
/** Explicit file selection and destination precede the existing export task. */
export function NativeExportDialog() {
  const [selected, setSelected] = createSignal<string[]>([]);
  const [format, setFormat] = createSignal('modrinth');
  const [version, setVersion] = createSignal('1.0.0');
  const [author, setAuthor] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const close = () => { setRequest(undefined); setSelected([]); };
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
        modpackName: record.name, version: exportVersion, author: exportAuthor, description: '',
      }));
      if (saved) close();
    } catch (reason) { reportInstanceError(reason); }
    finally { setBusy(false); }
  };
  return <Dialog closeLabel={t('nav.close')} title={t('instance-settings.export')} open={!!request()} onOpenChange={(open) => { if (!open && !busy()) close(); }}
    footer={<><Button variant="ghost" disabled={busy()} onClick={close}>{t('common.cancel')}</Button><Button tone="accent" disabled={busy() || !version().trim()} onClick={() => void exportPack()}>{t('instance-settings.export-action')}</Button></>}>
    <Select label={t('management.export-format')} value={format()} onChange={setFormat} options={[{ value: 'modrinth', label: 'Modrinth' }, { value: 'curseforge', label: 'CurseForge' }]} />
    <TextField label={t('management.export-version')} value={version()} onChange={setVersion} />
    <TextField label={t('management.export-author')} value={author()} onChange={setAuthor} />
    <Show when={request()}>{(current) => <>
      <Checkbox label={t('management.export-all')} checked={current().candidates.length > 0 && selected().length === current().candidates.length} onChange={(checked) => setSelected(checked ? current().candidates.map((item) => item.path) : [])} />
      <div style={{ 'max-height': '40vh', overflow: 'auto' }}><For each={current().candidates}>{(item) => <Checkbox label={item.path} checked={selected().includes(item.path)} onChange={(checked) => setSelected((paths) => checked ? [...paths, item.path] : paths.filter((path) => path !== item.path))} />}</For></div>
    </>}</Show>
  </Dialog>;
}
