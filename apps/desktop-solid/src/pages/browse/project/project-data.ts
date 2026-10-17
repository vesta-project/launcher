import { createEffect, createMemo, createSignal, untrack, type Accessor } from 'solid-js';
import { activateVersionFilter } from '../../../features/browse/version-filter';
import { projectKey, sortVersions, type ResourceProject, type ResourceVersion, type SourceId } from '../../../features/browse/browse-model';
import { loadProject, loadVersions, peekProject, peekVersions, watchProject } from '../../../features/browse/browse-projects';

export interface ProjectData {
  source: SourceId;
  id: string;
  key: string;
  /** Shown as soon as anything is known (a search hit seeds name, icon and stats). */
  project: Accessor<ResourceProject | undefined>;
  /** The full project (description, links) has arrived. */
  complete: Accessor<boolean>;
  error: Accessor<string | undefined>;
  /** Newest first. */
  versions: Accessor<ResourceVersion[] | undefined>;
  versionsError: Accessor<string | undefined>;
  retry: () => void;
}

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/** Project and version list for one page; cached data shows at once and is revalidated. */
export function useProjectData(source: SourceId, id: string): ProjectData {
  const [project, setProject] = createSignal<ResourceProject | undefined>(untrack(() => peekProject(source, id)), {
    name: 'projectPageProject',
  });
  const [complete, setComplete] = createSignal(false, { name: 'projectPageComplete' });
  const [error, setError] = createSignal<string | undefined>(undefined, { name: 'projectPageError' });
  const [raw, setRaw] = createSignal<ResourceVersion[] | undefined>(untrack(() => peekVersions(source, id)), {
    name: 'projectPageVersionsRaw',
  });
  const [versionsError, setVersionsError] = createSignal<string | undefined>(undefined, {
    name: 'projectPageVersionsError',
  });
  const [attempt, setAttempt] = createSignal(0, { name: 'projectPageAttempt' });
  const versions = createMemo(
    () => {
      const list = raw();
      return list ? sortVersions(list) : undefined;
    },
    { name: 'projectPageVersions' },
  );

  createEffect(
    () => attempt(),
    () => {
      activateVersionFilter(projectKey(source, id));
      let live = true;
      const stop = watchProject(source, id, (next) => {
        if (live && next) setProject(next);
      });
      setError(undefined);
      setVersionsError(undefined);
      loadProject(source, id).then(
        (next) => {
          if (!live) return;
          setProject(next);
          setComplete(true);
        },
        (reason) => live && setError(message(reason)),
      );
      loadVersions(source, id).then(
        (list) => live && setRaw(list),
        (reason) => live && setVersionsError(message(reason)),
      );
      return () => {
        live = false;
        stop();
      };
    },
  );

  return {
    source,
    id,
    key: projectKey(source, id),
    project,
    complete,
    error,
    versions,
    versionsError,
    retry: () => setAttempt((count) => count + 1),
  };
}
