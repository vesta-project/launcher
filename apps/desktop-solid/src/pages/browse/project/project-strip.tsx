import { transitionTo } from '../../../app/transition';
import type { Creator, ResourceProject, ResourceType } from '../../../features/browse/browse-model';
import { browseCategory, browseCreator, browsePath, syncTarget } from '../../../features/browse/browse-store';
import { t } from '../../../localization';
import { TargetSelect } from '../target-select';

/**
 * The install target at the end of the chrome strip, right under the Install button. Changing
 * it here keeps the page (Browse proper keeps its target in the route).
 */
export function StripTarget(props: { kind: ResourceType }) {
  return (
    <label data-vesta="project-strip-target">
      <span data-vesta="project-strip-label">{t('browse.install-to')}</span>
      <TargetSelect class="project-target-select" kind={props.kind} onChange={(id) => syncTarget(id)} />
    </label>
  );
}

/** Leaves a project page for Browse, filtered by one of its categories or creators. */
export function leaveForBrowse(project: ResourceProject, by: 'creator' | { category: string } | { creator: Creator }) {
  if (by === 'creator') browseCreator(project);
  else if ('category' in by) browseCategory(project, by.category);
  else browseCreator(project, by.creator);
  transitionTo(browsePath());
}
