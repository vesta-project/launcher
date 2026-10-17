import { Button } from '@vesta/ui';
import { createEffect, createSignal } from 'solid-js';
import { goBack } from '../../app/transition';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { isSourceId } from '../../features/browse/browse-model';
import { loadProject, peekProject, watchProject } from '../../features/browse/browse-projects';
import { t } from '../../localization';

const decode = (value: string | undefined) => {
  try {
    return value === undefined ? '' : decodeURIComponent(value);
  } catch {
    return value ?? '';
  }
};

/** Stand-in for the project page (phase 2): the name from the cache and a way back. */
export function ProjectPlaceholder(props: { platform: string | undefined; id: string | undefined }) {
  const platform = () => decode(props.platform);
  const id = () => decode(props.id);
  const [name, setName] = createSignal('', { name: 'browseProjectName' });

  createEffect(
    () => ({ source: platform(), projectId: id() }),
    ({ source, projectId }) => {
      setName(peekProject(source, projectId)?.name ?? projectId);
      if (!isSourceId(source)) return;
      const stop = watchProject(source, projectId, (project) => project && setName(project.name));
      void loadProject(source, projectId).catch(() => undefined);
      return stop;
    },
  );

  return (
    <Board>
      <EmptyState icon="icons/content/cube" title={name()} description={t('browse.project-soon')}>
        <Button
          size="sm"
          variant="outline"
          icon={<Icon name="icons/navigation/arrow-back" size={14} />}
          onClick={() => goBack('/browse')}
        >
          {t('common.back')}
        </Button>
      </EmptyState>
    </Board>
  );
}
