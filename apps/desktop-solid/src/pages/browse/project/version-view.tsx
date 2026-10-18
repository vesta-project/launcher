import type { JSX } from '@solidjs/web';
import { Badge, Button, IconButton, Skeleton } from '@vesta/ui';
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { canGoBack, navigate, previousPath } from '../../../app/router';
import { goBack, transitionTo } from '../../../app/transition';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import {
  displayLoaders,
  filterVersions,
  formatBytes,
  formatCompact,
  minecraftVersionsOf,
  projectPath,
  versionFiles,
  versionFit,
  versionPath,
  type DependencyType,
  type ResourceDependency,
  type ResourceProject,
  type ResourceVersion,
  type ResourceVersionDetails,
} from '../../../features/browse/browse-model';
import { loadProjects, loadVersionDetails, peekVersionDetails } from '../../../features/browse/browse-projects';
import { setNotice, target } from '../../../features/browse/browse-store';
import { versionFilterFor } from '../../../features/browse/version-filter';
import { formatNumber, t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { copyText } from '../../../platform/clipboard';
import { InstallButton } from '../install-button';
import { openExternal, runInstall } from '../install-actions';
import type { ProjectData } from './project-data';
import { ProjectHeader, versionWebUrl, WebMenu } from './project-header';
import {
  ChannelBadge,
  formatDay,
  LoaderChips,
  ProjectIcon,
  sameAction,
  versionAction,
} from './project-shared';
import { StripTarget } from './project-strip';
import { openVersion } from './project-versions';
import { RichTextView } from './rich-text-view';

/** Minecraft versions shown before the rest fold behind "Show all". */
const shownGames = 12;
const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));
const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const dependencyGroups: { kind: DependencyType; label: MessageId }[] = [
  { kind: 'required', label: 'browse.dependency-required' },
  { kind: 'optional', label: 'browse.dependency-optional' },
  { kind: 'embedded', label: 'browse.dependency-embedded' },
  { kind: 'incompatible', label: 'browse.dependency-incompatible' },
];

const fileRoles: Record<string, MessageId> = {
  primary: 'browse.file-primary',
  datapack: 'browse.file-role-datapack',
  'data-pack': 'browse.file-role-datapack',
  resourcepack: 'browse.file-role-resourcepack',
  'resource-pack': 'browse.file-role-resourcepack',
};

function Section(props: { title: string; count?: number; children: JSX.Element }) {
  return (
    <section data-vesta="project-facts-group">
      <h3>
        {props.title}
        <Show when={props.count !== undefined}>
          <span data-vesta="project-tab-count">{formatNumber(props.count!)}</span>
        </Show>
      </h3>
      {props.children}
    </section>
  );
}

/** Supported Minecraft versions (folded when long), loaders, and the fit for the target. */
function Compatibility(props: { project: ResourceProject; version: ResourceVersion }) {
  const [all, setAll] = createSignal(false, { name: 'versionShowAllGames' });
  const games = createMemo(() => minecraftVersionsOf(props.version.game_versions), { name: 'versionGames' });
  const visible = () => (all() ? games() : games().slice(0, shownGames));
  const loaders = () => displayLoaders(props.version.loaders);
  const fit = createMemo(
    () => {
      const info = target();
      if (!info || props.project.resource_type === 'modpack') return undefined;
      return { name: info.name, loader: info.modloader, result: versionFit(props.version, info, props.project.resource_type, props.project.source) };
    },
    { name: 'versionFitTarget' },
  );
  return (
    <Section title={t('browse.version-compatibility')}>
      <Show when={fit()}>
        {(current) => (
          <Switch>
            <Match when={current().result.kind === 'fits' && !(current().result as { borrowedLoader: boolean }).borrowedLoader}>
              <p data-vesta="project-fit" data-tone="success">
                <Icon name="icons/controls/check" size={12} />
                {t('browse.version-fits', { title: current().name })}
              </p>
            </Match>
            <Match when={current().result.kind === 'fits'}>
              <p data-vesta="project-fit" data-tone="warning">
                <Icon name="icons/controls/warning" size={12} />
                {t(current().loader.toLowerCase() === 'quilt' ? 'browse.reason-fabric-on-quilt' : 'browse.reason-forge-on-neoforge')}
              </p>
            </Match>
            <Match when={true}>
              <p data-vesta="project-fit" data-tone="danger">
                <Icon name="icons/controls/warning" size={12} />
                {t('browse.version-misfit', { title: current().name })}
              </p>
            </Match>
          </Switch>
        )}
      </Show>
      <Show when={games().length}>
        <div data-vesta="project-games" aria-label={t('browse.section-version')}>
          <For each={visible()}>{(game) => <span data-vesta="project-game">{game}</span>}</For>
          <Show when={games().length > shownGames}>
            <button type="button" data-vesta="project-more" aria-expanded={all() ? 'true' : 'false'} onClick={() => setAll(!all())}>
              {all() ? t('browse.show-fewer') : t('browse.show-all', { count: games().length })}
            </button>
          </Show>
        </div>
      </Show>
      <Show when={loaders().length}>
        <LoaderChips loaders={props.version.loaders} aria-label={t('browse.section-loader')} />
      </Show>
    </Section>
  );
}

function Files(props: { version: ResourceVersion }) {
  const files = () => versionFiles(props.version);
  return (
    <Show when={files().length}>
      <Section title={t('browse.version-files')} count={files().length > 1 ? files().length : undefined}>
        <ul data-vesta="project-files">
          <For each={files()} keyed={(file) => file.url}>
            {(file) => {
              const name = () => file().file_name || decode(file().url.split(/[?#]/)[0].split('/').pop() ?? '') || file().url;
              const role = () => fileRoles[file().role.toLowerCase()];
              return (
                <li data-vesta="project-file">
                  <Icon name="icons/content/file" size={16} />
                  <span data-vesta="project-file-text">
                    <strong data-tip-overflow="">{name()}</strong>
                    <small>
                      <Show when={role() && (files().length > 1 || file().role.toLowerCase() !== 'primary')}>
                        <Badge size="sm" tone={file().role.toLowerCase() === 'primary' ? 'accent' : 'neutral'} variant="soft">
                          {t(role()!)}
                        </Badge>
                      </Show>
                      {formatBytes(file().file_size)}
                    </small>
                  </span>
                  <Show when={file().hash}>
                    {(hash) => (
                      <IconButton
                        size="sm"
                        variant="ghost"
                        label={t('browse.file-copy-hash')}
                        icon={<Icon name="icons/actions/copy" size={14} />}
                        onClick={() =>
                          void copyText(hash()).then(
                            () => setNotice({ tone: 'neutral', text: t('browse.hash-copied') }),
                            () => undefined,
                          )
                        }
                      />
                    )}
                  </Show>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={t('browse.file-download')}
                    disabled={!file().url}
                    data-href={file().url || undefined}
                    icon={<Icon name="icons/actions/download" size={14} />}
                    onClick={() => void openExternal(file().url)}
                  />
                </li>
              );
            }}
          </For>
        </ul>
      </Section>
    </Show>
  );
}

/** Dependencies by kind; each opens its project (or the exact version it pins) here. */
function Dependencies(props: { project: ResourceProject; version: ResourceVersion }) {
  const list = () => props.version.dependencies ?? [];
  const ids = createMemo(() => [...new Set(list().map((item) => item.project_id).filter(Boolean))].join('\n'), {
    name: 'versionDependencyIds',
  });
  const [projects, setProjects] = createSignal<Map<string, ResourceProject> | undefined>(undefined, {
    name: 'versionDependencyProjects',
  });
  createEffect(ids, (joined) => {
    if (!joined) {
      setProjects(new Map());
      return;
    }
    let live = true;
    setProjects(undefined);
    loadProjects(props.project.source, joined.split('\n')).then(
      (found) => live && setProjects(found),
      () => live && setProjects(new Map()),
    );
    return () => {
      live = false;
    };
  });

  const Row = (row: { dependency: ResourceDependency }) => {
    const found = () => projects()?.get(row.dependency.project_id);
    const name = () => found()?.name || row.dependency.file_name || row.dependency.project_id || t('browse.dependency-unknown');
    const path = () => {
      const project = found();
      if (!project) return undefined;
      return row.dependency.version_id
        ? versionPath(project.source, project.id, row.dependency.version_id)
        : projectPath(project.source, project.id);
    };
    return (
      <li>
        <Show
          when={path()}
          fallback={
            <div data-vesta="project-dependency" data-unresolved="">
              <Show when={projects()} fallback={<Skeleton width={28} height={28} radius={6} />}>
                <span data-vesta="project-dependency-icon" data-empty="">
                  <Icon name="icons/content/cube" size={14} />
                </span>
              </Show>
              <span data-vesta="project-dependency-text">
                <strong>{name()}</strong>
              </span>
            </div>
          }
        >
          {(href) => (
            <a data-vesta="project-dependency" href={`#${href()}`} onClick={(event) => openVersion(event, href())}>
              <ProjectIcon project={found()!} hook="project-dependency-icon" />
              <span data-vesta="project-dependency-text">
                <strong>{name()}</strong>
                <Show when={found()?.summary}>
                  <small>{found()!.summary}</small>
                </Show>
              </span>
              <Show when={row.dependency.version_id}>
                <Badge size="sm" variant="outline">
                  {t('browse.dependency-pinned')}
                </Badge>
              </Show>
              <Icon name="icons/controls/chevron-right" size={12} />
            </a>
          )}
        </Show>
      </li>
    );
  };

  return (
    <Show when={list().length}>
      <Section title={t('browse.version-dependencies')}>
        <For each={dependencyGroups}>
          {(group) => (
            <Show when={list().filter((item) => item.dependency_type === group.kind)}>
              {(items) => (
                <Show when={items().length}>
                  <div data-vesta="project-dependency-group" data-kind={group.kind}>
                    <h4>{t(group.label)}</h4>
                    <ul>
                      <For each={items()} keyed={(item) => `${item.project_id}:${item.version_id ?? ''}:${item.file_name ?? ''}`}>
                        {(item) => <Row dependency={item()} />}
                      </For>
                    </ul>
                  </div>
                </Show>
              )}
            </Show>
          )}
        </For>
      </Section>
    </Show>
  );
}

function Changelog(props: {
  details: ResourceVersionDetails | undefined;
  error: string | undefined;
  onRetry: () => void;
}) {
  return (
    <section data-vesta="project-changelog" aria-labelledby="project-changelog-title">
      <h2 id="project-changelog-title">{t('browse.version-changelog')}</h2>
      <Switch>
        <Match when={props.error && !props.details}>
          <div data-vesta="project-inline-state">
            <p>{t('browse.changelog-failed')}</p>
            <Button size="sm" variant="outline" onClick={() => props.onRetry()}>
              {t('browse.retry')}
            </Button>
          </div>
        </Match>
        <Match when={!props.details}>
          <div data-vesta="project-article-loading" aria-busy="true" aria-label={t('linking.changelog-loading')}>
            <Skeleton width={180} height={16} />
            <Skeleton height={12} />
            <Skeleton height={12} />
            <Skeleton width={260} height={12} />
          </div>
        </Match>
        <Match when={props.details?.changelog_status === 'available' && props.details.changelog?.trim()}>
          {(text) => <RichTextView source={text() as string} format={props.details!.changelog_format} />}
        </Match>
        <Match when={props.details?.changelog_status === 'unavailable'}>
          <div data-vesta="project-inline-state">
            <p>{t('browse.changelog-failed')}</p>
            <Button size="sm" variant="outline" onClick={() => props.onRetry()}>
              {t('browse.retry')}
            </Button>
          </div>
        </Match>
        <Match when={true}>
          <p data-vesta="project-muted">{t('linking.changelog-empty')}</p>
        </Match>
      </Switch>
    </section>
  );
}

/**
 * One version, in focus: the header names it and installs exactly it; the strip steps to the
 * newer or older version in the list it was opened from; the pane has the changelog beside
 * compatibility, files and dependencies (which come first when the pane is narrow).
 */
export function VersionView(props: { data: ProjectData; project: ResourceProject; versionId: string }) {
  const [details, setDetails] = createSignal<ResourceVersionDetails | undefined>(undefined, { name: 'versionDetails' });
  const [error, setError] = createSignal<string | undefined>(undefined, { name: 'versionDetailsError' });
  const [attempt, setAttempt] = createSignal(0, { name: 'versionDetailsAttempt' });

  createEffect(
    () => ({ id: props.versionId, attempt: attempt() }),
    ({ id, attempt }) => {
      let live = true;
      setDetails(peekVersionDetails(props.data.source, props.data.id, id));
      setError(undefined);
      loadVersionDetails(props.data.source, props.data.id, id, attempt > 0).then(
        (next) => live && setDetails(next),
        (reason) => live && setError(message(reason)),
      );
      return () => {
        live = false;
      };
    },
  );

  /** The details carry the freshest copy; the list's copy shows first. */
  const version = createMemo(
    () => {
      const fresh = details();
      if (fresh?.version.id === props.versionId) return fresh.version;
      return props.data.versions()?.find((item) => item.id === props.versionId);
    },
    { name: 'versionFocused' },
  );

  // Previous/next follow the Versions tab's filtered list when this version is in it.
  const sequence = createMemo(
    () => {
      const all = props.data.versions() ?? [];
      const canFit = !!target() && props.project.resource_type !== 'modpack';
      const filter = versionFilterFor(props.data.key);
      const filtered = filterVersions(
        all,
        { ...filter, fits: filter.fits && canFit },
        { target: target(), type: props.project.resource_type, source: props.project.source },
      );
      return filtered.some((item) => item.id === props.versionId) ? filtered : all;
    },
    { name: 'versionSequence' },
  );
  const position = () => sequence().findIndex((item) => item.id === props.versionId);
  const newer = () => (position() > 0 ? sequence()[position() - 1] : undefined);
  const older = () => (position() >= 0 ? sequence()[position() + 1] : undefined);
  const step = (to: ResourceVersion | undefined) => {
    if (to) navigate(versionPath(props.data.source, props.data.id, to.id), { replace: true });
  };
  const listPath = () => projectPath(props.data.source, props.data.id, 'versions');

  const action = createMemo(
    () => {
      const current = version();
      return current ? versionAction(props.project, current) : undefined;
    },
    { name: 'versionPageAction', equals: (a, b) => (a && b ? sameAction(a, b) : a === b) },
  );

  return (
    <Show
      when={version()}
      fallback={
        <div data-vesta="project-layout">
          <Show
            when={(props.data.versions() && error()) || props.data.versionsError()}
            fallback={
              <div data-vesta="project-state" aria-busy="true" aria-label={t('browse.loading-version')}>
                <Skeleton width={260} height={20} />
                <Skeleton width={180} height={12} />
              </div>
            }
          >
            <EmptyState icon="icons/content/layers" title={t('browse.version-missing')} description={error()}>
              <Button size="sm" variant="outline" onClick={() => transitionTo(listPath())}>
                {t('browse.all-versions')}
              </Button>
            </EmptyState>
          </Show>
        </div>
      }
    >
      {(current) => (
        <div data-vesta="project-layout">
          <ProjectHeader
            project={props.project}
            compact
            eyebrow={
              <a
                data-vesta="project-header-parent"
                href={`#${projectPath(props.project.source, props.project.id)}`}
                onClick={(event) => openVersion(event, projectPath(props.project.source, props.project.id))}
              >
                {props.project.name}
              </a>
            }
            title={
              <>
                <span data-vesta="project-header-name">{current().version_number}</span>
                <ChannelBadge channel={current().release_type} />
              </>
            }
            meta={
              <>
                <Show when={formatDay(current().published_at)}>
                  <span data-vesta="project-stat">
                    <Icon name="icons/content/history" size={12} />
                    {formatDay(current().published_at)}
                  </span>
                </Show>
                <Show when={typeof current().download_count === 'number'}>
                  <span data-vesta="project-stat" data-tip={t('browse.downloads-title', { count: current().download_count as number })}>
                    <Icon name="icons/actions/download" size={12} />
                    {formatCompact(current().download_count as number)}
                  </span>
                </Show>
                <Show when={formatBytes(current().file_size)}>
                  <span data-vesta="project-stat">
                    <Icon name="icons/content/file" size={12} />
                    {formatBytes(current().file_size)}
                  </span>
                </Show>
              </>
            }
            actions={
              <>
                <InstallButton
                  size="md"
                  primary
                  state={() => action()?.state ?? { kind: 'install' }}
                  disabled={action()?.waiting}
                  hint={action()?.replaces && target() ? t('browse.install-replaces', { title: target()!.name }) : undefined}
                  targetName={() => (props.project.resource_type === 'modpack' ? undefined : target()?.name)}
                  onRun={() => void runInstall(props.project, props.project.resource_type, target(), current())}
                />
                <WebMenu url={versionWebUrl(props.project, current().id)} source={props.project.source} />
              </>
            }
          />
          <div data-vesta="project-strip" data-kind="version">
            <Button
              size="sm"
              variant="ghost"
              icon={<Icon name="icons/navigation/arrow-back" size={14} />}
              onClick={() => {
                if (previousPath() !== listPath() || !canGoBack()) return transitionTo(listPath(), undefined, { replace: true });
                goBack(listPath());
              }}
            >
              {t('browse.all-versions')}
            </Button>
            <div data-vesta="project-stepper">
              <IconButton
                size="sm"
                variant="ghost"
                label={t('browse.version-newer')}
                disabled={!newer()}
                icon={<Icon name="icons/controls/chevron-left" size={14} />}
                onClick={() => step(newer())}
              />
              <Show when={position() >= 0}>
                <span data-vesta="project-stepper-position">
                  {t('browse.version-position', { found: formatNumber(position() + 1), count: formatNumber(sequence().length) })}
                </span>
              </Show>
              <IconButton
                size="sm"
                variant="ghost"
                label={t('browse.version-older')}
                disabled={!older()}
                icon={<Icon name="icons/controls/chevron-right" size={14} />}
                onClick={() => step(older())}
              />
            </div>
            <StripTarget kind={props.project.resource_type} />
          </div>
          <div data-vesta="project-scroll" class="project-pane">
            <div data-vesta="project-overview" data-kind="version">
              <article data-vesta="project-article">
                <Changelog details={details()} error={error()} onRetry={() => setAttempt((count) => count + 1)} />
              </article>
              <aside data-vesta="project-facts" aria-label={t('browse.version-facts')}>
                <Compatibility project={props.project} version={current()} />
                <Files version={current()} />
                <Dependencies project={props.project} version={current()} />
              </aside>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
