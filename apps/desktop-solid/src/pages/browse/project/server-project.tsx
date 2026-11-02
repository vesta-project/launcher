import type { JSX } from '@solidjs/web';
import { Button, IconButton } from '@vesta/ui';
import { createMemo, onSettled, Show } from 'solid-js';
import { Icon } from '../../../components/icon';
import { Notice } from '../../../components/notice';
import {
  formatCompact,
  projectKey,
  summarizeGameVersions,
  versionPath,
  type ResourceProject,
  type ServerListing,
} from '../../../features/browse/browse-model';
import { setNotice } from '../../../features/browse/browse-store';
import { discoverServerLinks, joinableInstances, linkedInstanceFor } from '../../../features/browse/server-links';
import { serverGameVersions, serverPack } from '../../../features/browse/server-listing';
import { t } from '../../../localization';
import { copyText } from '../../../platform/clipboard';
import { openServerPicker } from '../install-actions';
import { clearServerActionError, joinWithNewInstance, playLinked, serverActionError, serverBusy } from '../server-actions';
import { regionText, ServerContentLabel, ServerPlayers, ServerRegion } from '../server-parts';
import type { ProjectData } from './project-data';
import { openVersion } from './project-versions';
import { ProjectIcon } from './project-shared';

const copyAddress = (address: string) =>
  void copyText(address).then(
    () => setNotice({ tone: 'neutral', text: t('browse.server-address-copied') }),
    () => undefined,
  );

/** The header's meta line for a listing: address with Copy, live players, what it plays, region. */
export function ServerMeta(props: { listing: ServerListing }) {
  return (
    <>
      <span data-vesta="project-server-address">
        <code data-tip={t('browse.server-address')}>{props.listing.address}</code>
        <IconButton
          size="sm"
          variant="ghost"
          label={t('browse.server-copy-address')}
          icon={<Icon name="icons/actions/copy" size={12} />}
          onClick={() => copyAddress(props.listing.address)}
        />
      </span>
      <ServerPlayers ping={props.listing.ping} hook="project-stat" />
      <ServerContentLabel listing={props.listing} hook="project-stat" />
      <ServerRegion region={props.listing.region} hook="project-stat" />
    </>
  );
}

/**
 * The listing's primary action. Linked: Play with <instance> (and Change). Not linked: a
 * modpack listing installs its pack as a new linked instance (Install & play; an instance that
 * already has the pack can be chosen instead), a vanilla listing asks which instance plays it.
 */
export function ServerActions(props: { project: ResourceProject }) {
  // Links live with the host, so the library is asked once which instances follow listings.
  onSettled(() => void discoverServerLinks());
  const linked = createMemo(() => linkedInstanceFor(props.project.id), { name: 'projectServerLinked' });
  const pack = () => serverPack(props.project.server);
  const canChoose = createMemo(() => joinableInstances(props.project).some((row) => !row.linked), {
    name: 'projectServerJoinable',
  });
  const busy = () => serverBusy() === projectKey(props.project.source, props.project.id);
  const address = () => props.project.server?.address ?? '';
  const playing = () => {
    const kind = linked()?.state.kind;
    return kind === 'running' || kind === 'warming' || kind === 'installing';
  };
  return (
    <Show
      when={linked()}
      fallback={
        <Show
          when={pack()}
          fallback={
            <Button
              size="md"
              variant="solid"
              tone="accent"
              disabled={!props.project.server || busy()}
              data-tip={t('browse.server-play-hint', { value: address() })}
              icon={<Icon name="icons/actions/play" size={14} />}
              onClick={() => openServerPicker(props.project)}
            >
              {t('browse.server-play')}
            </Button>
          }
        >
          <Button
            size="md"
            variant="solid"
            tone="accent"
            disabled={busy()}
            data-busy={busy() ? '' : undefined}
            data-tip={t('browse.server-install-hint', { value: address() })}
            icon={<Icon name="icons/actions/download" size={14} />}
            onClick={() => void joinWithNewInstance(props.project)}
          >
            {t('browse.server-install-play')}
          </Button>
          <Show when={canChoose()}>
            <Button size="md" variant="ghost" disabled={busy()} onClick={() => openServerPicker(props.project)}>
              {t('browse.server-use-instance')}
            </Button>
          </Show>
        </Show>
      }
    >
      {(entry) => (
        <>
          <Button
            size="md"
            variant="solid"
            tone="accent"
            disabled={busy() || playing()}
            data-busy={busy() || entry().state.kind === 'warming' ? '' : undefined}
            data-tip={t('browse.server-play-hint', { value: address() })}
            icon={<Icon name="icons/actions/play" size={14} />}
            onClick={() => void playLinked(props.project, entry().instance.id)}
          >
            {t('browse.server-play-with', { name: entry().instance.name })}
          </Button>
          <Button size="md" variant="ghost" disabled={busy()} onClick={() => openServerPicker(props.project)}>
            {t('browse.server-change')}
          </Button>
        </>
      )}
    </Show>
  );
}

/** A failed Install & play, link or launch for this listing, with Retry. */
export function ServerActionNotice(props: { project: ResourceProject }) {
  const error = () => {
    const current = serverActionError();
    return current?.key === projectKey(props.project.source, props.project.id) ? current : undefined;
  };
  return (
    <Show when={error()}>
      {(current) => (
        <div data-vesta="project-server-notice">
          <Notice
            tone="danger"
            details={current().details}
            action={{ label: t('browse.retry'), onClick: () => current().retry() }}
            actions={
              <IconButton
                size="sm"
                variant="ghost"
                label={t('browse.dismiss')}
                icon={<Icon name="icons/actions/close" size={12} />}
                onClick={clearServerActionError}
              />
            }
          >
            {t(current().message)}
          </Notice>
        </div>
      )}
    </Show>
  );
}

function FactGroup(props: { title: string; children: JSX.Element }) {
  return (
    <section data-vesta="project-facts-group">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

/**
 * The Overview's server facts: what it plays as a card (the modpack, which opens that pack
 * version, or vanilla with its recommended version), then address, region, languages, software
 * and recent plays.
 */
export function ServerFacts(props: { data: ProjectData; project: ResourceProject; listing: ServerListing }) {
  const pack = () => serverPack(props.listing);
  const packVersion = createMemo(
    () => {
      const content = pack();
      if (!content || content.projectId !== props.project.id) return undefined;
      return props.data.versions()?.find((version) => version.id === content.versionId)?.version_number;
    },
    { name: 'projectServerPackVersion' },
  );
  const games = createMemo(() => serverGameVersions(props.listing), { name: 'projectServerGames' });
  const languages = () => props.listing.languages.map((code) => code.toUpperCase()).join(', ');
  return (
    <FactGroup title={t('browse.server-facts')}>
      <div data-vesta="project-dependency-group" data-kind="server-content">
        <h4>{t('browse.server-content')}</h4>
        <ul>
          <li>
            <Show
              when={pack()}
              fallback={
                <div data-vesta="project-dependency" data-kind="vanilla">
                  <span data-vesta="project-dependency-icon" data-empty="">
                    <Icon name="icons/content/cube" size={14} />
                  </span>
                  <span data-vesta="project-dependency-text">
                    <strong>{t('browse.server-content-vanilla')}</strong>
                    <Show when={props.listing.content.kind === 'vanilla' && props.listing.content.recommendedVersion}>
                      {(version) => <small>{t('browse.server-recommended', { version: version() })}</small>}
                    </Show>
                  </span>
                </div>
              }
            >
              {(content) => {
                const href = () => versionPath('modrinth', content().projectId, content().versionId);
                return (
                  <a data-vesta="project-dependency" data-kind="modpack" href={`#${href()}`} onClick={(event) => openVersion(event, href())}>
                    <ProjectIcon
                      project={{ name: content().projectName ?? props.project.name, icon_url: content().projectIcon }}
                      hook="project-dependency-icon"
                    />
                    <span data-vesta="project-dependency-text">
                      <strong>{content().projectName ?? props.project.name}</strong>
                      <small>
                        <Show when={packVersion()} fallback={t('browse.kind-modpack')}>
                          {(version) => t('browse.server-pack-version', { version: version() })}
                        </Show>
                      </small>
                    </span>
                    <Icon name="icons/controls/chevron-right" size={12} />
                  </a>
                );
              }}
            </Show>
          </li>
        </ul>
      </div>
      <dl data-vesta="project-details">
        <Show when={games().length}>
          <dt>{t('browse.facts-minecraft')}</dt>
          <dd data-tip={games().length > 2 ? games().join(', ') : undefined}>{summarizeGameVersions(games())}</dd>
        </Show>
        <dt>{t('browse.server-address')}</dt>
        <dd data-vesta="project-server-address-fact">
          <code>{props.listing.address}</code>
        </dd>
        <Show when={regionText(props.listing.region)}>
          <dt>{t('browse.server-region')}</dt>
          <dd>{regionText(props.listing.region)}</dd>
        </Show>
        <Show when={languages()}>
          <dt>{t('browse.server-languages')}</dt>
          <dd>{languages()}</dd>
        </Show>
        <Show when={props.listing.ping?.versionName}>
          <dt>{t('browse.server-software')}</dt>
          <dd data-tip-overflow="">{props.listing.ping!.versionName}</dd>
        </Show>
        <Show when={props.listing.plays2w !== null}>
          <dt>{t('browse.server-plays')}</dt>
          <dd>{formatCompact(props.listing.plays2w ?? 0)}</dd>
        </Show>
      </dl>
    </FactGroup>
  );
}

