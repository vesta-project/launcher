import { Button, Checkbox, Dialog } from '@vesta/ui';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createEffect, createSignal, For, onSettled, Show } from 'solid-js';
import { nativeInstances, performNative, reportInstanceError } from './native-service';
import { t } from '../../localization';

interface Choice {
  decisionId: string; operationId: string; instanceId: number; phase: string;
  candidates: { id: string; name: string; kinds: string[] }[];
  dependencies: { name: string; version: string }[]; notes: string[];
}
interface ArchiveChoice { installId: string; candidates: { id: string; name: string }[] }
let ready: Promise<unknown> | undefined;
let operations = new Set<string>();
export async function importNativeWorld(id: string) {
  const session = ready, started = operations;
  if (!session) return;
  try {
    await session;
    if (ready !== session) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const paths = await open({ multiple: true, filters: [{ name: 'World archives', extensions: ['zip', 'mcworld'] }] });
    if (!paths || ready !== session) return;
    await performNative(id, async () => {
      const operationId = await invoke<string>('start_resource_drop', { instanceId: Number(id), paths: Array.isArray(paths) ? paths : [paths] });
      if (ready === session) started.add(operationId);
      else await invoke('cancel_resource_drop', { operationId });
    });
  } catch (reason) { reportInstanceError(reason); }
}
/** Own the existing native import decisions while this instance is mounted. */
export function NativeImportDialog(props: { instanceId: string }) {
  const [choice, setChoice] = createSignal<Choice>();
  const [archive, setArchive] = createSignal<ArchiveChoice>();
  const [selected, setSelected] = createSignal<string[]>([]);
  const [submitting, setSubmitting] = createSignal(false);
  const candidates = () => archive()?.candidates ?? choice()?.candidates.filter((row) => row.kinds.includes('world')) ?? [];
  createEffect(() => archive()?.installId ?? choice()?.decisionId, () => { setSelected([]); });
  const submit = async (cancel = false) => {
    if (submitting()) return;
    setSubmitting(true);
    try {
      const currentArchive = archive(), current = choice();
      if (currentArchive) {
        await invoke('submit_world_archive_selection', { installId: currentArchive.installId, selectedCandidateIds: cancel ? [] : selected() });
        setArchive(undefined);
      } else if (current) {
        await invoke('submit_resource_drop_choice', { decisionId: current.decisionId, response: {
          cancel, selections: cancel ? [] : selected().map((candidateId) => ({ candidateId, kind: 'world' })),
          downloadDependencies: !cancel && current.phase === 'dependencies',
        } });
        setChoice(undefined);
      }
    } catch (reason) { reportInstanceError(reason); }
    finally { setSubmitting(false); }
  };
  onSettled(() => {
    if (!nativeInstances) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => disposed ? stop() : stops.push(stop);
    const register = <T,>(event: string, receive: (value: T) => void) => listen<T>(event, ({payload}) => { if (!disposed) receive(payload); }).then(keep);
    const pending = Promise.all([
      register<Choice>('core://manual-resource-drop-choice', (value) => { if (String(value.instanceId) === props.instanceId) setChoice(value); }),
      register<{decisionId:string}>('core://manual-resource-drop-choice-closed', (value) => { if (choice()?.decisionId === value.decisionId) setChoice(undefined); }),
      register<ArchiveChoice>('core://world-install-selection-required', setArchive),
      register<{installId:string}>('core://world-install-selection-closed', (value) => { if (archive()?.installId === value.installId) setArchive(undefined); }),
    ]);
    const started = new Set<string>();
    operations = started;
    ready = pending;
    void pending.catch(reportInstanceError);
    return () => {
      disposed = true; stops.forEach((stop) => stop());
      if (ready === pending) ready = undefined;
      for (const operationId of started) void invoke('cancel_resource_drop', { operationId }).catch((reason) => {
        if (!String(reason).includes('no longer active')) reportInstanceError(reason);
      });
      const current = choice(), currentArchive = archive();
      if (current && !started.has(current.operationId)) void invoke('cancel_resource_drop', { operationId: current.operationId }).catch(reportInstanceError);
      if (currentArchive) void invoke('submit_world_archive_selection', { installId: currentArchive.installId, selectedCandidateIds: [] }).catch(reportInstanceError);
    };
  });
  return <Dialog open={!!choice() || !!archive()} title={t('worlds.import')} onOpenChange={(open) => { if (!open) void submit(true); }}
    footer={<><Button variant="ghost" disabled={submitting()} onClick={() => void submit(true)}>{t('common.cancel')}</Button>
      <Button tone="accent" disabled={submitting() || (choice()?.phase !== 'dependencies' && selected().length === 0)} onClick={() => void submit()}>{t('worlds.import')}</Button></>}>
    <For each={choice()?.notes ?? []}>{(note) => <p>{note}</p>}</For>
    <Show when={choice()?.phase === 'dependencies'}><p>{t('management.import-dependencies')}</p><For each={choice()?.dependencies ?? []}>{(item) => <p>{item.name} {item.version}</p>}</For></Show>
    <For each={candidates()}>{(item) => <Checkbox label={item.name} checked={selected().includes(item.id)} onChange={(checked) => setSelected((ids) => checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />}</For>
    <Show when={choice()?.phase === 'resources' && !candidates().length}><p>{t('management.no-world-archives')}</p></Show>
  </Dialog>;
}
