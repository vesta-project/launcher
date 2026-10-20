import { For, Show } from 'solid-js';
import { Button } from '@vesta/ui';
import { EmptyState } from '../../components/empty-state';
import { t } from '../../localization';
import { nativeInstances, nativeRecord, instancePending, instancesLoaded } from '../../features/instances/native-service';
import { NativeExportDialog } from "../../features/instances/native-export-dialog";
import { Board } from '../../components/board';
import { instances, playInstance, retryInstance, type InstanceEntry } from '../../features/instances/catalog';
import { InstanceCard } from '../../features/instances/instance-card';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { InstancePage } from './instance/instance-page';
import './library-page.css';
import { useNativeDropZone } from '../../features/file-drop/zone';
import { importNativePaths } from '../../features/instances/native-import-dialog';

/** Each actual tile is a native drop target, ahead of the scene's untargeted fallback. */
function LibraryInstanceCard(props: { entry: InstanceEntry }) {
  let item: HTMLLIElement | undefined;
  const id = () => props.entry.instance.id;
  useNativeDropZone({
    element: () => item?.querySelector<HTMLElement>('[data-vesta="instance-card"]') ?? undefined,
    accept: 'files',
    extensions: ['.jar', '.zip'],
    disabled: () => instancePending(id()) || ['installing', 'pending', 'verifying-runtime', 'launch-preflight-repair']
      .includes(nativeRecord(id())?.installationStatus ?? ''),
    hint: () => t('drop.add-to', { name: props.entry.instance.name }),
    drop: (paths) => { void importNativePaths(id(), paths); },
  });
  return (
    <li ref={(element: HTMLLIElement) => { item = element; }}>
      <InstanceCard
        instance={props.entry.instance}
        state={props.entry.state}
        pending={instancePending(id())}
        onOpen={() => transitionTo(`/library/${id()}`, id())}
        onOpenCrash={() => transitionTo(`/library/${id()}/crash`, id())}
        onPlay={() => playInstance(id())}
        onRetry={() => retryInstance(id(), 'Installing')}
        onResume={() => retryInstance(id(), 'Resuming')}
      />
    </li>
  );
}

/** Library: the instance grid, or one instance when the route names it. */
export function LibraryPage() {
  return (
    <>
      <Show when={route().section} keyed fallback={
        <Board>
          <Show when={!nativeInstances || instancesLoaded()} fallback={<p role="status">{t('management.loading')}</p>}>
          <Show when={instances().length > 0} fallback={<>
            <EmptyState icon="icons/rail/library" title={t('management.empty')} description={t('management.empty-description')} />
            <Button tone="accent" onClick={() => transitionTo('/create')}>{t('management.create')}</Button>
          </>}>
          <ul data-vesta="library-grid">
            <For each={instances()} keyed={(entry) => entry.instance.id}>
              {(entry) => (
                <LibraryInstanceCard entry={entry()} />
              )}
            </For>
          </ul>
          </Show></Show>
        </Board>
      }>
        {(id) => <InstancePage id={id} />}
      </Show>
      <NativeExportDialog />
    </>
  );
}
