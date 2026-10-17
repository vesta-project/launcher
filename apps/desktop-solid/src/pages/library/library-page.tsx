import { For, Show, createSignal } from 'solid-js';
import { Button, Dialog } from '@vesta/ui';
import { EmptyState } from '../../components/empty-state';
import { t } from '../../localization';
import { nativeInstances, instancePending, instancesLoaded, openNativeInstanceFolder, repairNativeInstance, duplicateNativeInstance, resetNativeInstance, deleteNativeInstance } from '../../features/instances/native-service';
import { NativeExportDialog, requestNativeExport } from "../../features/instances/native-export-dialog";
import { Board } from '../../components/board';
import { instances, playInstance, retryInstance, togglePin } from '../../features/instances/catalog';
import { InstanceCard } from '../../features/instances/instance-card';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { InstancePage } from './instance/instance-page';
import './library-page.css';

/** Library: the instance grid, or one instance when the route names it. */
export function LibraryPage() {
  const [deleting, setDeleting] = createSignal<string>();
  const [resetting, setResetting] = createSignal<string>();
  const [removing, setRemoving] = createSignal(false);
  const confirmDelete = async () => {
    const id = deleting(); if (!id || removing()) return;
    setRemoving(true);
    try { if (await deleteNativeInstance(id)) setDeleting(undefined); }
    finally { setRemoving(false); }
  };
  return (
    <>
      {route().section ? (
        <InstancePage id={route().section as string} />
      ) : (
        <Board>
          <Show when={!nativeInstances || instancesLoaded()} fallback={<p role="status">{t('management.loading')}</p>}>
          <Show when={instances().length > 0} fallback={<>
            <EmptyState icon="icons/rail/library" title={t('management.empty')} description={t('management.empty-description')} />
            <Button tone="accent" onClick={() => transitionTo('/create')}>{t('management.create')}</Button>
          </>}>
          <ul data-vesta="library-grid">
            <For each={instances()} keyed={(entry) => entry.instance.id}>
              {(entry) => (
                <li>
                  <InstanceCard
                    instance={entry().instance}
                    state={entry().state}
                    pending={instancePending(entry().instance.id)}
                    onOpen={() => transitionTo(`/library/${entry().instance.id}`, entry().instance.id)}
                    onOpenCrash={() => transitionTo(`/library/${entry().instance.id}/crash`, entry().instance.id)}
                    onTogglePin={() => togglePin(entry().instance.id)}
                    onOpenFolder={nativeInstances ? () => void openNativeInstanceFolder(entry().instance.id) : undefined}
                    onRepair={nativeInstances ? () => void repairNativeInstance(entry().instance.id) : undefined}
                    onDuplicate={nativeInstances ? () => void duplicateNativeInstance(entry().instance.id) : undefined}
                    onExport={nativeInstances ? () => void requestNativeExport(entry().instance.id) : undefined}
                    onHardReset={nativeInstances ? () => setResetting(entry().instance.id) : undefined}
                    onUninstall={nativeInstances ? () => setDeleting(entry().instance.id) : undefined}
                    onPlay={() => playInstance(entry().instance.id)}
                    onRetry={() => retryInstance(entry().instance.id, 'Installing')}
                    onResume={() => retryInstance(entry().instance.id, 'Resuming')}
                  />
                </li>
              )}
            </For>
          </ul>
          </Show></Show>
        </Board>
      )}
      <NativeExportDialog />
      <Dialog title={t('instance-settings.reset-title')} description={t('instance-settings.reset-confirm-description')}
        open={!!resetting()} onOpenChange={(open) => { if (!open) setResetting(undefined); }} size="sm"
        footer={<><Button variant="ghost" onClick={() => setResetting(undefined)}>{t('common.cancel')}</Button>
          <Button tone="danger" onClick={() => { const id = resetting(); if (id) void resetNativeInstance(id); setResetting(undefined); }}>{t('instance-settings.reset-action')}</Button></>}
      />
      <Dialog title={t('instance-settings.delete-title')} description={t('instance-settings.delete-confirm-description')}
        open={!!deleting()} onOpenChange={(open)=>{if(!open && !removing())setDeleting(undefined);}} size="sm"
        footer={<><Button variant="ghost" disabled={removing()} onClick={()=>setDeleting(undefined)}>{t('common.cancel')}</Button>
          <Button tone="danger" disabled={removing()} onClick={()=>void confirmDelete()}>{t('common.delete')}</Button></>}
      />
    </>
  );
}
