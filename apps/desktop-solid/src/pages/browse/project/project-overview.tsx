import type { JSX } from '@solidjs/web';
import { ImageViewer, Skeleton } from '@vesta/ui';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import {
  descriptionFormat,
  isLoaderCategory,
  projectKey,
  projectPath,
  selectInstallVersion,
  sourceById,
  summarizeGameVersions,
  versionFacets,
  versionPath,
  type Creator,
  type ProjectLink,
  type ResourceProject,
} from '../../../features/browse/browse-model';
import { loadPeerProject } from '../../../features/browse/browse-projects';
import { categoryName, ensureCategories, installed, target } from '../../../features/browse/browse-store';
import { t } from '../../../localization';
import { openExternal } from '../install-actions';
import type { ProjectData } from './project-data';
import { leaveForBrowse } from './project-strip';
import { ChannelBadge, failed, formatDay, LoaderMarks, loaded } from './project-shared';
import { RichTextView } from './rich-text-view';

const linkIcon = (link: ProjectLink) => {
  const identity = `${link.kind} ${link.label} ${link.url}`.toLowerCase();
  if (/discord|chat|matrix|zulip/.test(identity)) return 'icons/content/chat';
  if (/issue|bug|tracker/.test(identity)) return 'icons/status/bug';
  if (/source|github|gitlab|codeberg|code/.test(identity)) return 'icons/content/code';
  if (/wiki|docs|documentation/.test(identity)) return 'icons/content/help';
  if (link.donation || /ko-?fi|patreon|donat|paypal|sponsor/.test(identity)) return 'icons/content/heart';
  if (/website|homepage/.test(identity)) return 'icons/content/globe';
  return 'icons/content/link';
};

interface CreatorRow {
  key: string;
  name: string;
  role: string;
  icon: string | null;
  filter: Creator | undefined;
}

function creatorsOf(project: ResourceProject): CreatorRow[] {
  const rows: CreatorRow[] = [];
  const organization = project.organization;
  if (organization)
    rows.push({
      key: `org:${organization.id}`,
      name: organization.name,
      role: t('browse.creator-organization'),
      icon: organization.icon_url,
      filter: { kind: 'organization', id: organization.id, name: organization.name, icon_url: organization.icon_url },
    });
  for (const author of project.author_details ?? [])
    rows.push({
      key: `user:${author.id || author.username}`,
      name: author.username,
      role: author.role || (author.is_owner ? t('browse.creator-owner') : t('browse.creator-member')),
      icon: author.avatar_url,
      filter: author.id ? { kind: 'author', id: author.id, name: author.username, icon_url: author.avatar_url } : undefined,
    });
  if (!rows.length && project.author)
    rows.push({ key: 'author', name: project.author, role: t('browse.creator-owner'), icon: null, filter: undefined });
  return rows;
}

function FactGroup(props: { title: string; children: JSX.Element }) {
  return (
    <section data-vesta="project-facts-group">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

/** What the target instance would get: the version Install picks, or why nothing fits. */
function TargetFit(props: { data: ProjectData; project: ResourceProject }) {
  const fit = createMemo(
    () => {
      const info = target();
      const versions = props.data.versions();
      if (!info || !versions || props.project.resource_type === 'modpack') return undefined;
      const row = installed().get(projectKey(props.project.source, props.project.id));
      return {
        name: info.name,
        choice: selectInstallVersion(versions, info, props.project.resource_type, props.project.source),
        installed: row ? (versions.find((version) => version.id === row.remote_version_id) ?? null) : undefined,
      };
    },
    { name: 'projectTargetFit' },
  );
  return (
    <Show when={fit()}>
      {(current) => (
        <FactGroup title={t('browse.fit-title', { title: current().name })}>
          <Show
            when={current().choice}
            fallback={
              <p data-vesta="project-fit" data-tone="danger">
                <Icon name="icons/controls/warning" size={12} />
                {t('browse.reason-no-version')}
              </p>
            }
          >
            {(choice) => (
              <a
                data-vesta="project-fit-version"
                href={`#${versionPath(props.project.source, props.project.id, choice().version.id)}`}
                onClick={(event) => {
                  event.preventDefault();
                  transitionTo(versionPath(props.project.source, props.project.id, choice().version.id));
                }}
              >
                <span data-vesta="project-fit-label">{t('browse.fit-best')}</span>
                <strong>{choice().version.version_number}</strong>
                <ChannelBadge channel={choice().version.release_type} />
                <Icon name="icons/controls/chevron-right" size={12} />
              </a>
            )}
          </Show>
          <Show when={current().choice?.borrowedLoader}>
            <p data-vesta="project-fit" data-tone="warning">
              {t(
                (target()?.modloader ?? '').toLowerCase() === 'quilt'
                  ? 'browse.reason-fabric-on-quilt'
                  : 'browse.reason-forge-on-neoforge',
              )}
            </p>
          </Show>
          <Show when={current().installed !== undefined}>
            <p data-vesta="project-fit" data-tone="success">
              <Icon name="icons/controls/check" size={12} />
              {current().installed
                ? t('browse.fit-installed', { version: current().installed!.version_number })
                : t('browse.status-installed')}
            </p>
          </Show>
        </FactGroup>
      )}
    </Show>
  );
}

/**
 * The Description tab: the project's own text beside a column of facts (fit for the target,
 * details, categories, creators, links). The facts drop under the text when the pane narrows.
 */
export function ProjectOverview(props: { data: ProjectData; project: ResourceProject }) {
  const [viewing, setViewing] = createSignal<number | undefined>(undefined, { name: 'projectDescriptionImage' });
  const [inline, setInline] = createSignal<string | undefined>(undefined, { name: 'projectDescriptionInline' });
  const [peer, setPeer] = createSignal<ResourceProject | null>(null, { name: 'projectPeer' });

  createEffect(
    () => props.project.source,
    (source) => ensureCategories(source),
  );
  // The same project on the other big source, once the full project is known.
  createEffect(
    () => (props.data.complete() && props.project.source !== 'smithed' ? props.project : undefined),
    (project) => {
      if (!project) return;
      let live = true;
      loadPeerProject(project).then(
        (found) => live && setPeer(found),
        () => undefined,
      );
      return () => {
        live = false;
      };
    },
  );

  const facets = createMemo(() => versionFacets(props.data.versions() ?? []), { name: 'projectFacets' });
  const categories = createMemo(
    () =>
      [...new Set(props.project.categories)]
        .filter((raw) => !isLoaderCategory(raw))
        .map((raw) => ({ raw, label: categoryName(props.project.source, raw) })),
    { name: 'projectCategories' },
  );
  const creators = createMemo(() => creatorsOf(props.project), { name: 'projectCreators' });
  const links = createMemo(
    () => {
      const seen = new Set<string>([props.project.web_url]);
      return (props.project.links ?? []).filter((link) => link.url && !seen.has(link.url) && seen.add(link.url));
    },
    { name: 'projectLinks' },
  );
  const environment = () => {
    const value = props.project.environment;
    if (!value) return undefined;
    if (value.client && value.server) return t('browse.environment-both');
    if (value.client) return t('browse.environment-client');
    if (value.server) return t('browse.environment-server');
    return undefined;
  };
  const viewerImages = () => {
    const extra = inline();
    const gallery = props.project.gallery.map((src) => ({ src }));
    return extra && !props.project.gallery.includes(extra) ? [{ src: extra }, ...gallery] : gallery;
  };
  const openImage = (src: string) => {
    const index = props.project.gallery.indexOf(src);
    setInline(index < 0 ? src : undefined);
    setViewing(index < 0 ? 0 : index);
  };

  return (
    <div data-vesta="project-overview">
      <article data-vesta="project-article">
        <Show
          when={props.project.description?.trim()}
          fallback={
            <Show
              when={props.data.complete() || props.data.error()}
              fallback={
                <div data-vesta="project-article-loading" aria-busy="true" aria-label={t('browse.loading-project')}>
                  <Skeleton width={220} height={18} />
                  <Skeleton height={12} />
                  <Skeleton height={12} />
                  <Skeleton width={320} height={12} />
                  <Skeleton height={120} />
                </div>
              }
            >
              <p data-vesta="project-article-summary">{props.project.summary}</p>
              <p data-vesta="project-muted">{t('browse.no-description')}</p>
            </Show>
          }
        >
          {(text) => (
            <RichTextView
              source={text()}
              format={descriptionFormat(props.project)}
              aria-label={t('browse.tab-description')}
              onImage={openImage}
            />
          )}
        </Show>
      </article>

      <aside data-vesta="project-facts" aria-label={t('browse.project-facts')}>
        <TargetFit data={props.data} project={props.project} />

        <FactGroup title={t('browse.facts-details')}>
          <dl data-vesta="project-details">
            <Show when={facets().gameVersions.length}>
              <dt>{t('browse.section-version')}</dt>
              <dd data-tip={facets().gameVersions.length > 2 ? facets().gameVersions.join(', ') : undefined}>
                {summarizeGameVersions(facets().gameVersions)}
              </dd>
            </Show>
            <Show when={facets().loaders.length}>
              <dt>{t('browse.section-loader')}</dt>
              <dd>
                <LoaderMarks loaders={facets().loaders} />
              </dd>
            </Show>
            <Show when={environment()}>
              <dt>{t('browse.section-environment')}</dt>
              <dd>{environment()}</dd>
            </Show>
            <Show when={formatDay(props.project.published_at)}>
              <dt>{t('browse.facts-published')}</dt>
              <dd>{formatDay(props.project.published_at)}</dd>
            </Show>
            <Show when={formatDay(props.project.updated_at)}>
              <dt>{t('browse.facts-updated')}</dt>
              <dd>{formatDay(props.project.updated_at)}</dd>
            </Show>
          </dl>
        </FactGroup>

        <Show when={categories().length}>
          <FactGroup title={t('browse.section-categories')}>
            <div data-vesta="project-tags">
              <For each={categories()} keyed={(item) => item.raw}>
                {(item) => (
                  <button
                    type="button"
                    data-vesta="browse-tag"
                    data-tip={t('browse.browse-category', { name: item().label })}
                    onClick={() => leaveForBrowse(props.project, { category: item().raw })}
                  >
                    <span>{item().label}</span>
                  </button>
                )}
              </For>
            </div>
          </FactGroup>
        </Show>

        <Show when={creators().length}>
          <FactGroup title={t('browse.facts-creators')}>
            <ul data-vesta="project-creators">
              <For each={creators()} keyed={(row) => row.key}>
                {(row) => (
                  <li>
                    <button
                      type="button"
                      data-vesta="project-creator"
                      disabled={!row().filter}
                      data-tip={row().filter ? t('browse.filter-by-author', { author: row().name }) : undefined}
                      onClick={() => {
                        const filter = row().filter;
                        if (filter) leaveForBrowse(props.project, { creator: filter });
                      }}
                    >
                      <span data-vesta="project-creator-avatar" aria-hidden="true">
                        {row().name.charAt(0).toUpperCase()}
                        <Show when={row().icon}>
                          {(url) => <img src={url()} alt="" loading="lazy" decoding="async" onLoad={loaded} onError={failed} />}
                        </Show>
                      </span>
                      <span data-vesta="project-creator-text">
                        <strong>{row().name}</strong>
                        <small>{row().role}</small>
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </FactGroup>
        </Show>

        <FactGroup title={t('browse.facts-links')}>
          <ul data-vesta="project-links">
            <Show when={props.project.web_url}>
              <li>
                <button type="button" data-vesta="project-link" onClick={() => void openExternal(props.project.web_url)}>
                  <Icon name={sourceById(props.project.source).icon} size={14} />
                  <span>{t('browse.open-on', { source: sourceById(props.project.source).label })}</span>
                  <Icon name="icons/actions/external-link" size={12} />
                </button>
              </li>
            </Show>
            <Show when={peer()}>
              {(other) => (
                <li>
                  <button
                    type="button"
                    data-vesta="project-link"
                    data-internal=""
                    onClick={() => transitionTo(projectPath(other().source, other().id))}
                  >
                    <Icon name={sourceById(other().source).icon} size={14} />
                    <span>{t('browse.also-on', { source: sourceById(other().source).label })}</span>
                    <Icon name="icons/controls/chevron-right" size={12} />
                  </button>
                </li>
              )}
            </Show>
            <For each={links()} keyed={(link) => link.url}>
              {(link) => (
                <li>
                  <button
                    type="button"
                    data-vesta="project-link"
                    data-donation={link().donation ? '' : undefined}
                    onClick={() => void openExternal(link().url)}
                  >
                    <Icon name={linkIcon(link())} size={14} />
                    <span>{link().label}</span>
                    <Icon name="icons/actions/external-link" size={12} />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </FactGroup>
      </aside>

      <ImageViewer
        open={viewing() !== undefined}
        onOpenChange={(open) => !open && setViewing(undefined)}
        images={viewerImages()}
        index={viewing() ?? 0}
        onIndexChange={setViewing}
      />
    </div>
  );
}
