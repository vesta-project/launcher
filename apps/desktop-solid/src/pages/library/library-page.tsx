import { For, Show } from 'solid-js';
import { Button } from '@vesta/ui';
import { EmptyState } from '../../components/empty-state';
import { t } from '../../localization';
import { nativeInstances, instancePending, instancesLoaded } from '../../features/instances/native-service';
import { NativeExportDialog } from "../../features/instances/native-export-dialog";
import { Board } from '../../components/board';
import { instances, playInstance, retryInstance } from '../../features/instances/catalog';
import { InstanceCard } from '../../features/instances/instance-card';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { InstancePage } from './instance/instance-page';
import './library-page.css';
import { InstanceActionDialogs } from '../../features/instances/action-menu';

/** Library: the instance grid, or one instance when the route names it. */
export function LibraryPage() {
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
      <InstanceActionDialogs />
    </>
  );
}
