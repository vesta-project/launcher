import { Tab, TabList, TabPanel, Tabs } from '@vesta/ui';
import { createEffect, createMemo, createSignal, Show, untrack } from 'solid-js';
import { navigate, route } from '../../../app/router';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import {
  creatorOf,
  formatCompact,
  formatRelative,
  isProjectTab,
  ownerName,
  projectKey,
  projectPath,
  sourceById,
  type ProjectTab,
  type ResourceProject,
  type SourceId,
} from '../../../features/browse/browse-model';
import { loadPeerProjectId } from '../../../features/browse/browse-projects';
import { modpackTargetName, sameState, serverTarget, target, targetName as installTargetName } from '../../../features/browse/browse-store';
import { formatNumber, t } from '../../../localization';
import { InstallButton } from '../install-button';
import { runInstall } from '../install-actions';
import { ProjectGallery } from './project-gallery';
import { ProjectHeader, WebMenu } from './project-header';
import { ProjectOverview } from './project-overview';
import { ProjectVersions } from './project-versions';
import { formatDay, kindLabels, projectInstallState } from './project-shared';
import type { ProjectData } from './project-data';
import { StripTarget, leaveForBrowse } from './project-strip';
import { ServerActionNotice, ServerActions, ServerMeta } from './server-project';
import { serverPack } from '../../../features/browse/server-listing';

/** Author (filters Browse by them) and the stats a card shows, on one line. */
function ProjectMeta(props: { project: ResourceProject }) {
  const author = () => ownerName(props.project);
  const updated = () => formatRelative(props.project.updated_at, Date.now());
  return (
    <>
      <Show when={author()}>
        <Show
          when={creatorOf(props.project)}
          fallback={<span data-vesta="project-header-author">{t('browse.by-author', { author: author() })}</span>}
        >
          <button
            type="button"
            data-vesta="project-header-author"
            data-tip={t('browse.filter-by-author', { author: author() })}
            onClick={() => leaveForBrowse(props.project, 'creator')}
          >
            {t('browse.by-author', { author: author() })}
          </button>
        </Show>
      </Show>
      <span data-vesta="project-stat" data-tip={t('browse.downloads-title', { count: props.project.download_count })}>
        <Icon name="icons/actions/download" size={12} />
        {formatCompact(props.project.download_count)}
      </span>
      <Show when={props.project.follower_count > 0}>
        <span data-vesta="project-stat" data-tip={t('browse.followers-title', { count: props.project.follower_count })}>
          <Icon name="icons/content/heart" size={12} />
          {formatCompact(props.project.follower_count)}
        </span>
      </Show>
      <Show when={updated()}>
        <span data-vesta="project-stat" data-tip={t('browse.updated-on', { date: formatDay(props.project.updated_at) })}>
          <Icon name="icons/content/history" size={12} />
          {updated()}
        </span>
      </Show>
    </>
  );
}

const decode = (value: string | undefined) => {
  try {
    return value === undefined ? '' : decodeURIComponent(value);
  } catch {
    return value ?? '';
  }
};

/** Sources that can list the same project; always shown in this order. */
const switchSources = ['modrinth', 'curseforge'] as const satisfies readonly SourceId[];

/**
 * The source tag, which becomes a two-way switch once the same project is proven to exist on
 * the other big source. The lookup runs only here (never for search results), after the full
 * project has loaded; a late answer for a project the route has since left is dropped.
 * Switching replaces the history entry and keeps the open tab.
 */
function SourceSwitch(props: { data: ProjectData; project: ResourceProject; tab: ProjectTab }) {
  const [peer, setPeer] = createSignal<{ source: SourceId; id: string } | null>(null, { name: 'projectPeer' });
  createEffect(
    () =>
      // Server listings exist on Modrinth only.
      props.data.complete() &&
      props.project.resource_type !== 'server' &&
      switchSources.some((source) => source === props.project.source)
        ? { project: props.project, asked: projectKey(props.data.source, props.data.id) }
        : undefined,
    (request) => {
      if (!request) return;
      const { project, asked } = request;
      let live = true;
      loadPeerProjectId(project).then(
        (found) => {
          const current = untrack(route);
          if (live && projectKey(decode(current.detail), decode(current.item)) === asked) setPeer(found);
        },
        () => undefined,
      );
      return () => {
        live = false;
      };
    },
  );
  const option = (source: SourceId, other: { source: SourceId; id: string }) => {
    const content = (
      <>
        <Icon name={sourceById(source).icon} size={12} />
        <span data-vesta="project-source-label">{sourceById(source).label}</span>
      </>
    );
    return source === props.project.source ? (
      <span data-vesta="project-source-option" data-source={source} aria-current="true">
        {content}
      </span>
    ) : (
      <button
        type="button"
        data-vesta="project-source-option"
        data-source={source}
        onClick={() => transitionTo(projectPath(other.source, other.id, props.tab), undefined, { replace: true })}
      >
        {content}
      </button>
    );
  };
  return (
    <Show
      when={peer()}
      fallback={
        <span data-vesta="project-tag" data-source={props.project.source}>
          {sourceById(props.project.source).label}
        </span>
      }
    >
      {(other) => (
        <span data-vesta="project-source-switch" role="group" aria-label={t('browse.source-switch')}>
          {option('modrinth', other())}
          {option('curseforge', other())}
        </span>
      )}
    </Show>
  );
}

/**
 * A project: the art header with Install, a chrome strip of tabs (with the install target at its
 * end, under the Install button), then one scrolling pane per tab. Tabs are routes that replace
 * each other, so back leaves the project and returning from a version lands on its list.
 */
export function ProjectView(props: { data: ProjectData; project: ResourceProject; tab: string | undefined }) {
  const gallery = () => props.project.gallery.length;
  const active = (): ProjectTab =>
    isProjectTab(props.tab) && (props.tab !== 'gallery' || gallery() > 0) && (props.tab !== 'versions' || showVersions())
      ? props.tab
      : 'description';
  const open = (value: string) => {
    if (isProjectTab(value)) navigate(projectPath(props.data.source, props.data.id, value), { replace: true });
  };
  const state = createMemo(() => projectInstallState(props.project, props.data.versions()), {
    name: 'projectHeaderState',
    equals: sameState,
  });
  // Modpacks make a new instance unless a server is chosen, so only a server is a hint for them.
  const targetName = () => (props.project.resource_type === 'modpack' ? modpackTargetName() : installTargetName());
  const versionCount = () => props.data.versions()?.length;
  const listing = () => props.project.server ?? undefined;
  // A listing's Versions tab is its own modpack's releases; vanilla listings have none.
  const showVersions = () =>
    props.project.resource_type !== 'server' || serverPack(props.project.server)?.projectId === props.project.id;

  return (
    <div data-vesta="project-layout">
      <ProjectHeader
        project={props.project}
        title={
          <>
            <span data-vesta="project-header-name">{props.project.name}</span>
            <SourceSwitch data={props.data} project={props.project} tab={active()} />
            <span data-vesta="project-tag">{t(kindLabels[props.project.resource_type])}</span>
          </>
        }
        summary={props.project.summary}
        meta={
          <Show when={listing()} fallback={<ProjectMeta project={props.project} />}>
            {(current) => <ServerMeta listing={current()} />}
          </Show>
        }
        actions={
          <>
            <Show
              when={props.project.resource_type === 'server'}
              fallback={
                <InstallButton
                  size="md"
                  primary
                  state={state}
                  targetName={targetName}
                  onRun={() => void runInstall(props.project, props.project.resource_type, target())}
                />
              }
            >
              <ServerActions project={props.project} />
            </Show>
            <WebMenu url={props.project.web_url} source={props.project.source} />
          </>
        }
      />
      <ServerActionNotice project={props.project} />
      <Tabs size="sm" value={active()} onChange={open} class="project-tabs">
        <div data-vesta="project-strip">
          <TabList aria-label={t('browse.project-sections')}>
            <Tab value="description" icon={<Icon name="icons/content/file" size={14} />}>
              {t('browse.tab-description')}
            </Tab>
            <Show when={gallery() > 0}>
              <Tab
                value="gallery"
                icon={<Icon name="icons/content/grid" size={14} />}
                badge={<span data-vesta="project-tab-count">{formatNumber(gallery())}</span>}
              >
                {t('browse.tab-gallery')}
              </Tab>
            </Show>
            <Show when={showVersions()}>
              <Tab
                value="versions"
                icon={<Icon name="icons/content/layers" size={14} />}
                badge={
                  versionCount() !== undefined ? (
                    <span data-vesta="project-tab-count">{formatNumber(versionCount()!)}</span>
                  ) : undefined
                }
              >
                {t('browse.tab-versions')}
              </Tab>
            </Show>
          </TabList>
          {/* Listings are joined with an instance chosen by Play, not installed into a target. */}
          <Show when={props.project.resource_type !== 'server'}>
            <StripTarget kind={props.project.resource_type} />
          </Show>
        </div>
        <TabPanel value="description" class="project-pane" forceMount
          style={{ display: active() === 'description' ? undefined : 'none' }}>
          <ProjectOverview data={props.data} project={props.project} />
        </TabPanel>
        <Show when={gallery() > 0}>
          <TabPanel value="gallery" class="project-pane">
            <ProjectGallery project={props.project} />
          </TabPanel>
        </Show>
        <Show when={showVersions()}>
          <TabPanel value="versions" class="project-pane project-pane-flush">
            <ProjectVersions data={props.data} project={props.project} />
          </TabPanel>
        </Show>
      </Tabs>
    </div>
  );
}
