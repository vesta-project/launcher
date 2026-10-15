import { For } from 'solid-js';
import { Board } from '../../components/board';
import { instances, playInstance, retryInstance } from '../../features/instances/fixtures';
import { InstanceCard } from '../../features/instances/instance-card';
import { navigate, route } from '../../app/router';
import { InstancePage } from './instance-page';
import './library-page.css';

/** Library: the instance grid, or one instance when the route names it. */
export function LibraryPage() {
  return (
    <>
      {route().section ? (
        <InstancePage id={route().section as string} />
      ) : (
        <Board>
          <ul data-vesta="library-grid">
            <For each={instances()} keyed={(entry) => entry.instance.id}>
              {(entry) => (
                <li>
                  <InstanceCard
                    instance={entry().instance}
                    state={entry().state}
                    onOpen={() => navigate(`/library/${entry().instance.id}`)}
                    onOpenCrash={() => navigate(`/library/${entry().instance.id}`)}
                    onPlay={() => playInstance(entry().instance.id)}
                    onRetry={() => retryInstance(entry().instance.id, 'Installing')}
                    onResume={() => retryInstance(entry().instance.id, 'Resuming')}
                  />
                </li>
              )}
            </For>
          </ul>
        </Board>
      )}
    </>
  );
}
