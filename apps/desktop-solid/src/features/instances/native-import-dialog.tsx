import { Button, Checkbox, Dialog, Select } from '@vesta/ui';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createEffect, createSignal, For, onSettled, Show } from 'solid-js';
import { nativeInstances, performNative, reportInstanceError } from './native-service';
import { loadNativeWorlds } from './native-details';
import { worldsFor } from './details';
import type { WorldRef } from './native-details-model';
import { t } from '../../localization';

interface Choice {
  decisionId: string; operationId: string; instanceId: number; phase: string;
  candidates: { id: string; name: string; kinds: string[] }[];
  dependencies: { name: string; version: string }[]; notes: string[];
}
interface ArchiveChoice { installId: string; candidates: { id: string; name: string }[] }
let ready: Promise<unknown> | undefined;
const [operationWorlds, setOperationWorlds] = createSignal(new Map<string, WorldRef>());
const worldExpiry = new Map<string, ReturnType<typeof setTimeout>>();
function forgetOperationWorld(id: string) {
  clearTimeout(worldExpiry.get(id)); worldExpiry.delete(id);
  setOperationWorlds((values) => { const next = new Map(values); next.delete(id); return next; });
}
function rememberOperationWorld(id: string, world: WorldRef) {
  setOperationWorlds((values) => new Map(values).set(id, world));
  // Rust's decisions expire after 15 minutes. Bound context even when inspection finds no datapack.
  worldExpiry.set(id, setTimeout(() => forgetOperationWorld(id), 60 * 60 * 1000));
}
export async function importNativePaths(id: string, paths: string[], world?: WorldRef) {
  const session = ready;
  if (!session || !paths.length) return;
  if (world && operationWorlds().size >= 64) { reportInstanceError(t('drop.rejected')); return; }
  try {
    await session;
    if (ready !== session) return;
    await performNative(id, async () => {
      const operationId = await invoke<string>('start_resource_drop', { instanceId: Number(id), paths });
      if (ready === session && world) rememberOperationWorld(operationId, world);
    });
  } catch (reason) { reportInstanceError(reason); }
}
export async function importNativeWorld(id: string) {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const paths = await open({ multiple: true, filters: [{ name: 'World archives', extensions: ['zip', 'mcworld'] }] });
    if (paths) await importNativePaths(id, Array.isArray(paths) ? paths : [paths]);
  } catch (reason) { reportInstanceError(reason); }
}
/** Shell-owned review survives route changes; Rust owns background task lifetime. */
export function NativeImportDialog() {
  const [choices, setChoices] = createSignal<Choice[]>([]);
  const setChoice = (value: Choice | undefined) => setChoices((queue) => value ? [...queue.filter((item) => item.decisionId !== value.decisionId), value] : queue.slice(1));
  const [archives, setArchives] = createSignal<ArchiveChoice[]>([]);
  const archive = () => archives()[0];
  // Show one decision at a time; an archive must not inherit a queued resource/dependency form.
  const choice = () => archive() ? undefined : choices()[0];
  const setArchive = (value: ArchiveChoice | undefined) => setArchives((queue) => value ? [...queue.filter((item) => item.installId !== value.installId), value] : queue.slice(1));
  const [selected, setSelected] = createSignal<string[]>([]);
  const [kinds, setKinds] = createSignal<Record<string, string>>({});
  const [targetWorlds, setTargetWorlds] = createSignal<Record<string, string>>({});
  const [dependencies, setDependencies] = createSignal(true);
  const availableWorlds = () => choice() ? worldsFor(String(choice()!.instanceId)) : [];
  createEffect(() => { const current = choice(); return current?.candidates.some((row) => row.kinds.includes('dataPack')) ? current.instanceId : undefined; }, (id) => { if (id != null) void loadNativeWorlds(String(id)); });
  const kindLabels: Record<string, () => string> = {
    mod: () => t('resources.mod'), resourcePack: () => t('resources.pack'), shader: () => t('resources.shader'),
    dataPack: () => t('resources.datapack'), world: () => t('worlds.import'), modpack: () => t('install.import'),
  };
  const [submitting, setSubmitting] = createSignal(false);
  const candidates = () => archive()?.candidates.map((item) => ({ ...item, kinds: [] as string[] })) ?? choice()?.candidates ?? [];
  createEffect(() => archive()?.installId ?? choice()?.decisionId, () => {
    setSelected([]); setKinds({}); setTargetWorlds({}); setDependencies(true);
  });
  const submit = async (cancel = false) => {
    if (submitting()) return;
    setSubmitting(true);
    try {
      const currentArchive = archive(), current = choice();
      if (currentArchive) {
        await invoke('submit_world_archive_selection', { installId: currentArchive.installId, selectedCandidateIds: cancel ? [] : selected() });
        setArchives((queue) => queue.filter((item) => item.installId !== currentArchive.installId));
      } else if (current) {
        await invoke('submit_resource_drop_choice', { decisionId: current.decisionId, response: {
          cancel, selections: cancel ? [] : selected().map((candidateId) => {
            const candidate = current.candidates.find((row) => row.id === candidateId)!;
            const kind = kinds()[candidateId] ?? candidate.kinds[0];
            const world = operationWorlds().get(current.operationId) ?? (targetWorlds()[candidateId] ? { instanceId: current.instanceId, directoryName: targetWorlds()[candidateId]! } : undefined);
            return { candidateId, kind, ...(kind === 'dataPack' ? { world } : {}) };
          }),
          downloadDependencies: !cancel && current.phase === 'dependencies' && dependencies(),
        } });
        setChoices((queue) => queue.filter((item) => item.decisionId !== current.decisionId));
        forgetOperationWorld(current.operationId);
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
      register<Choice>('core://manual-resource-drop-choice', setChoice),
      register<{decisionId:string}>('core://manual-resource-drop-choice-closed', (value) => { const closed = choices().find((item) => item.decisionId === value.decisionId); if (closed) forgetOperationWorld(closed.operationId); setChoices((queue) => queue.filter((item) => item.decisionId !== value.decisionId)); }),
      register<ArchiveChoice>('core://world-install-selection-required', setArchive),
      register<{installId:string}>('core://world-install-selection-closed', (value) => { setArchives((queue) => queue.filter((item) => item.installId !== value.installId)); }),
    ]);
    ready = pending;
    void pending.catch(reportInstanceError);
    return () => {
      disposed = true; stops.forEach((stop) => stop());
      if (ready === pending) ready = undefined;
      for (const timer of worldExpiry.values()) clearTimeout(timer);
      worldExpiry.clear(); setOperationWorlds(new Map());
      // Dispose pending decisions only; already-running copies/installations remain Rust-owned.
      for (const current of choices()) void invoke('cancel_resource_drop', { operationId: current.operationId }).catch(reportInstanceError);
      for (const current of archives()) void invoke('submit_world_archive_selection', { installId: current.installId, selectedCandidateIds: [] }).catch(reportInstanceError);
    };
  });
  return <Dialog closeLabel={t('nav.close')} open={!!choice() || !!archive()} title={t('drop.review')} onOpenChange={(open) => { if (!open) void submit(true); }}
    footer={<><Button variant="ghost" disabled={submitting()} onClick={() => void submit(true)}>{t('common.cancel')}</Button>
      <Button tone="accent" disabled={submitting() || (choice()?.phase !== 'dependencies' && (selected().length === 0 || selected().some((id) => { const candidate = choice()?.candidates.find((row) => row.id === id); return (kinds()[id] ?? candidate?.kinds[0]) === 'dataPack' && !operationWorlds().get(choice()!.operationId) && !targetWorlds()[id]; })))} onClick={() => void submit()}>{t('worlds.import')}</Button></>}>
    <For each={choice()?.notes ?? []}>{(note) => <p>{note}</p>}</For>
    <Show when={choice()?.phase === 'dependencies'}><Checkbox label={t('drop.dependencies')} checked={dependencies()} onChange={setDependencies} /><For each={choice()?.dependencies ?? []}>{(item) => <p>{item.name} {item.version}</p>}</For></Show>
    <For each={candidates()}>{(item) => <div>
      <Checkbox label={item.name} checked={selected().includes(item.id)} onChange={(checked) => setSelected((ids) => checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />
      <Show when={item.kinds.length > 1}><Select aria-label={t('drop.kind')} value={kinds()[item.id] ?? item.kinds[0]} options={item.kinds.map((kind) => ({ value: kind, label: kindLabels[kind]?.() ?? kind }))} onChange={(kind) => setKinds((values) => ({ ...values, [item.id]: kind }))} /></Show>
      <Show when={(kinds()[item.id] ?? item.kinds[0]) === 'dataPack' && !operationWorlds().get(choice()!.operationId)}><Select aria-label={t('drop.world')} placeholder={t('drop.choose-world')} value={targetWorlds()[item.id] ?? ''} options={availableWorlds().map((world) => ({ value: world.id, label: world.name }))} onChange={(world) => setTargetWorlds((values) => ({ ...values, [item.id]: world }))} /></Show>
    </div>}</For>
    <Show when={choice()?.phase === 'resources' && !candidates().length}><p>{t('drop.no-candidates')}</p></Show>
  </Dialog>;
}
