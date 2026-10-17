import type { JSX } from '@solidjs/web';
import { IconButton, Menu, MenuItem } from '@vesta/ui';
import { Show } from 'solid-js';
import { Icon } from '../../../components/icon';
import { bannerOf, sourceById, type ResourceProject } from '../../../features/browse/browse-model';
import { setNotice } from '../../../features/browse/browse-store';
import { t } from '../../../localization';
import { copyText } from '../../../platform/clipboard';
import { openExternal } from '../install-actions';
import { failed, hueOf, loaded, ProjectIcon } from './project-shared';

/** The provider's page for one version, where the provider has one. */
export function versionWebUrl(project: ResourceProject, versionId: string): string | undefined {
  if (!project.web_url) return undefined;
  const base = project.web_url.replace(/\/+$/, '');
  if (project.source === 'modrinth') return `${base}/version/${encodeURIComponent(versionId)}`;
  if (project.source === 'curseforge') return `${base}/files/${encodeURIComponent(versionId)}`;
  return undefined;
}

/** Open on the provider and copy its link: secondary, so they live in a menu. */
export function WebMenu(props: { url: string | undefined; source: ResourceProject['source'] }) {
  return (
    <Show when={props.url}>
      {(url) => (
        <Menu
          placement="bottom-end"
          trigger={(menuProps) => (
            <IconButton
              {...menuProps}
              size="md"
              variant="ghost"
              label={t('browse.project-more')}
              icon={<Icon name="icons/controls/ellipsis-horizontal" size={16} />}
            />
          )}
        >
          <MenuItem
            icon={<Icon name={sourceById(props.source).icon} size={14} />}
            onSelect={() => void openExternal(url())}
          >
            {t('browse.open-on', { source: sourceById(props.source).label })}
          </MenuItem>
          <MenuItem
            icon={<Icon name="icons/actions/copy" size={14} />}
            onSelect={() =>
              void copyText(url()).then(
                () => setNotice({ tone: 'neutral', text: t('browse.link-copied') }),
                () => undefined,
              )
            }
          >
            {t('browse.copy-link')}
          </MenuItem>
        </Menu>
      )}
    </Show>
  );
}

/**
 * The art band at the top of the project and version pages, built like the instance header:
 * the project's banner (or its icon, blurred into colour) behind one row of identity and
 * actions. The project page fills it with stats; the version page names the version.
 */
export function ProjectHeader(props: {
  project: ResourceProject;
  /** Small line above the title (the version page links back to its project here). */
  eyebrow?: JSX.Element;
  title: JSX.Element;
  summary?: string;
  meta: JSX.Element;
  actions: JSX.Element;
  compact?: boolean;
}) {
  const banner = () => bannerOf(props.project);
  return (
    <header
      data-vesta="project-header"
      data-compact={props.compact ? '' : undefined}
      style={{ '--project-hue': hueOf(props.project.id) }}
    >
      <div data-vesta="project-header-art" aria-hidden="true">
        <Show
          when={banner()}
          fallback={
            <Show when={props.project.icon_url}>
              {(url) => (
                <img data-backdrop="" src={url()} alt="" decoding="async" onLoad={loaded} onError={failed} />
              )}
            </Show>
          }
        >
          {(url) => <img src={url()} alt="" decoding="async" onLoad={loaded} onError={failed} />}
        </Show>
      </div>
      <div data-vesta="project-header-main">
        <ProjectIcon project={props.project} hook="project-header-icon" />
        <div data-vesta="project-header-copy">
          <Show when={props.eyebrow}>
            <div data-vesta="project-header-eyebrow">{props.eyebrow}</div>
          </Show>
          <h1 data-vesta="project-header-title">{props.title}</h1>
          <Show when={props.summary}>
            <p data-vesta="project-header-summary">{props.summary}</p>
          </Show>
          <div data-vesta="project-header-meta">{props.meta}</div>
        </div>
        <div data-vesta="project-header-actions">{props.actions}</div>
      </div>
    </header>
  );
}
