import { transitionTo } from '../../../app/transition';
import { For, Show } from 'solid-js';
import { Button } from '@vesta/ui';


import { stableConnectionId } from '../../../features/servers/connection-id';


import { t } from '../../../localization';
import { anyVisible, gate } from '../../../features/servers/capabilities';
import { serverPressure, useServerResource } from '../../../features/servers/resources';
import { operationsResource } from '../../../features/servers/server-resources';
import { agentReachable, extraWarnings, headerNotice } from '../../../features/servers/shell-model';
import { OnlinePlayersPanel } from './players-tab';
import { ActivityRow } from './activity-tab';
import { serverOperations, useServerTopic, useServersClock } from '../../../features/servers/store';
import type { ServerSnapshot } from '../../../features/servers/native';
import { OverviewGraphs } from './overview-graphs';
import { Sensitive, ServerErrorNote } from '../parts';
import { PlayOnServerCard, canGetModpack, useClientPackOffer } from '../pack/get-modpack';

export function OverviewTab(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const id = stableConnectionId(() => props.snapshot);
  const metricsAllowed = () => gate(props.snapshot.capabilities, 'metrics.view') === 'allowed';
  // Metrics stream only while the overview is visible and allowed.
  useServerTopic(() => (metricsAllowed() && props.snapshot.state.phase === 'online' ? id() : undefined), 'metrics');
  const recent = () => serverOperations(id()).slice(0, 4);
  // Recent tasks: one cached read per connection; the operations topic keeps it current.
  const operations = useServerResource(id, operationsResource, { enabled: () => agentReachable(props.snapshot) && anyVisible(props.snapshot.capabilities, ['tasks.view']) });
  const offer = useClientPackOffer(() => props.snapshot);
  /** Warnings beyond the one the header strip already shows. */
  const warnings = () => extraWarnings(props.snapshot, headerNotice(props.snapshot, now(), serverPressure(id())));

  return (
    <div data-vesta="server-overview">
      <ServerErrorNote error={operations.error()} onRetry={() => void operations.refresh()} />
      <Show when={warnings().length > 0}>
        <div data-vesta="server-callout" data-tone="warning" role="status">
          <For each={warnings()}>{(message) => <p>{t(message)}</p>}</For>
        </div>
      </Show>

      {/* Nothing until the pack answer is in, so the play card never replaces another card. */}
      <Show when={offer.known()}>
        <Show when={canGetModpack(props.snapshot) && offer.offers()}>
          <PlayOnServerCard snapshot={props.snapshot} />
        </Show>
        <Show when={props.snapshot.pack && !offer.offers() ? props.snapshot.pack : null}>
          {(pack) => (
            <section data-vesta="server-cards">
              <article data-vesta="server-stat">
                <h2>{t('servers.overview.pack')}</h2>
                <Show when={pack().status === 'published'} fallback={<p data-vesta="server-muted">{t('servers.overview.pack-unpublished')}</p>}>
                  <dl>
                    <dt>{t('servers.overview.pack-revision')}</dt><dd>{pack().hostedRevision}</dd>
                    <dt>{t('servers.overview.pack-minimum')}</dt><dd>{pack().minimumRevision}</dd>
                  </dl>
                </Show>
                <PackActions snapshot={props.snapshot} />
              </article>
            </section>
          )}
        </Show>
      </Show>

      <Show when={metricsAllowed()}>
        <OverviewGraphs snapshot={props.snapshot} id={id()} now={now()} />
      </Show>

      <Show when={props.snapshot.status?.state === 'running' && anyVisible(props.snapshot.capabilities, ['players.view'])}>
        <OnlinePlayersPanel snapshot={props.snapshot} />
      </Show>

      <Show when={recent().length > 0}>
        <section data-vesta="server-recent">
          <h2>{t('servers.overview.recent')}</h2>
          <ul data-vesta="server-activity-list">
            <For each={recent()} keyed={(operation) => operation.operationId}>
              {(operation) => <ActivityRow operation={operation()} now={now()} compact />}
            </For>
          </ul>
        </section>
      </Show>

      <dl data-vesta="server-about">
        <Show when={props.snapshot.info?.agentVersion}><dt>{t('servers.overview.agent')}</dt><dd>{props.snapshot.info?.agentVersion}</dd></Show>
        <dt>{t('servers.server-id')}</dt><dd><code><Sensitive label={t('servers.server-id')}>{props.snapshot.connection.serverId}</Sensitive></code></dd>
      </dl>
    </div>
  );
}

/** All publication changes go through the client-pack review workspace. */
function PackActions(props: { snapshot: ServerSnapshot }) {
  return <Show when={gate(props.snapshot.capabilities, 'pack.edit') === 'allowed' || gate(props.snapshot.capabilities, 'pack.download') === 'allowed' || gate(props.snapshot.capabilities, 'pack.access') === 'allowed'}>
    <div data-vesta="server-stat-actions"><Button size="sm" variant="outline" onClick={() => transitionTo(`/servers/${encodeURIComponent(props.snapshot.connection.id)}/pack`)}>{t('server-pack.title')}</Button></div>
  </Show>;
}
