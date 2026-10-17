import { Button, Skeleton } from '@vesta/ui';
import { createEffect, createMemo, onSettled, Show, untrack } from 'solid-js';
import { route } from '../../../app/router';
import { goBack } from '../../../app/transition';
import { Board } from '../../../components/board';
import { EmptyState } from '../../../components/empty-state';
import { isSourceId, projectKey, type SourceId } from '../../../features/browse/browse-model';
import { listenForInstalls, refreshInstalled, targetId } from '../../../features/browse/browse-store';
import { t } from '../../../localization';
import { NoticeBar } from '../notice-bar';
import { useProjectData } from './project-data';
import { ProjectView } from './project-view';
import { VersionView } from './version-view';
import './project.css';

const decode = (value: string | undefined) => {
  try {
    return value === undefined ? '' : decodeURIComponent(value);
  } catch {
    return value ?? '';
  }
};

/** Placeholder header and strip while nothing at all is known about the project yet. */
function Loading() {
  return (
    <div data-vesta="project-layout" aria-busy="true" aria-label={t('browse.loading-project')}>
      <div data-vesta="project-header" data-skeleton="">
        <div data-vesta="project-header-main">
          <Skeleton width={56} height={56} radius={10} />
          <div data-vesta="project-header-copy">
            <Skeleton width={220} height={20} />
            <Skeleton width={320} height={12} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectScreen(props: { source: SourceId; id: string }) {
  const data = useProjectData(untrack(() => props.source), untrack(() => props.id));

  // Install states follow the target instance while the page is open (Browse does the same).
  onSettled(() => listenForInstalls());
  createEffect(
    () => targetId(),
    () => void refreshInstalled(),
  );

  const view = () => {
    const [first, second] = route().rest;
    return first === 'version' && second ? { version: decode(second) } : { tab: first };
  };
  const versionId = () => view().version;

  return (
    <Show
      when={data.project()}
      fallback={
        <Show when={data.error()} fallback={<Loading />}>
          {(message) => (
            <EmptyState icon="icons/status/error" title={t('browse.project-failed')} description={message()}>
              <div data-vesta="project-state-actions">
                <Button size="sm" onClick={() => data.retry()}>
                  {t('browse.retry')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => goBack('/browse')}>
                  {t('common.back')}
                </Button>
              </div>
            </EmptyState>
          )}
        </Show>
      }
    >
      {(project) => (
        <Show when={versionId()} fallback={<ProjectView data={data} project={project()} tab={view().tab} />}>
          {(id) => <VersionView data={data} project={project()} versionId={id()} />}
        </Show>
      )}
    </Show>
  );
}

/**
 * `#/browse/project/<source>/<id>[/<tab>]` and `…/version/<versionId>`. The screen is keyed by
 * project, so following a dependency starts fresh while tab and version changes stay in place.
 */
export function ProjectPage() {
  const target = createMemo(
    () => {
      const current = route();
      const source = decode(current.detail);
      const id = decode(current.item);
      return { source, id, key: projectKey(source, id) };
    },
    { name: 'projectPageRoute', equals: (a, b) => a.key === b.key },
  );
  return (
    <Board fixed class="project-board">
      <Show when={target()} keyed>
        {(current) => (
          <Show
            when={isSourceId(current.source) && current.id}
            fallback={<EmptyState icon="icons/content/cube" title={t('browse.project-missing')} />}
          >
            <ProjectScreen source={current.source as SourceId} id={current.id} />
          </Show>
        )}
      </Show>
      <div data-vesta="project-notice">
        <NoticeBar />
      </div>
    </Board>
  );
}
