import { transitionTo } from '../../../app/transition';
import { For, Show } from 'solid-js';
import { Button } from '@vesta/ui';


import { stableConnectionId } from '../../../features/servers/connection-id';


import { t } from '../../../localization';
import { anyVisible, gate } from '../../../features/servers/capabilities';
import { formatUptime, minecraftFact } from '../../../features/servers/model';
import { serverPressure, useServerResource } from '../../../features/servers/resources';
import { operationsResource } from '../../../features/servers/server-resources';
import { agentReachable, extraWarnings, headerNotice } from '../../../features/servers/shell-model';
import { OnlinePlayersPanel } from './players-tab';
import { ActivityRow } from './activity-tab';
import { serverOperations, useServerTopic, useServersClock } from '../../../features/servers/store';
import type { ServerSnapshot } from '../../../features/servers/native';
import { OverviewGraphs } from './overview-graphs';
import { FactBadge, Freshness, Sensitive, ServerErrorNote } from '../parts';
import { PlayOnServerCard, canGetModpack, offersClientPack } from '../pack/get-modpack';

export function OverviewTab(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const id = stableConnectionId(() => props.snapshot);
  const metricsAllowed = () => gate(props.snapshot.capabilities, 'metrics.view') !== 'denied';
  // Metrics stream only while the overview is visible and allowed.
  useServerTopic(() => (metricsAllowed() && props.snapshot.state.phase === 'online' ? id() : undefined), 'metrics');
  const status = () => props.snapshot.status;
  const recent = () => serverOperations(id()).slice(0, 4);
  // Recent tasks: one cached read per connection; the operations topic keeps it current.
  const operations = useServerResource(id, operationsResource, { enabled: () => agentReachable(props.snapshot) && anyVisible(props.snapshot.capabilities, ['tasks.view']) });
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

      <section data-vesta="server-cards">
        <article data-vesta="server-stat">
          <h2>{t('servers.overview.minecraft')}</h2>
          <FactBadge fact={agentReachable(props.snapshot) ? minecraftFact(status()) : { ...minecraftFact(status()), tone: 'neutral' }} />
          <dl>
            <dt>{t('servers.overview.version')}</dt><dd>{props.snapshot.info?.minecraftVersion || t('servers.unknown')}</dd>
            <dt>{t('servers.overview.uptime')}</dt><dd>{formatUptime(status()?.uptimeSeconds ?? null) ?? t('servers.unknown')}</dd>
          </dl>
          <Freshness atMs={props.snapshot.statusObservedAtMs} now={now()} phase={props.snapshot.state.phase} />
        </article>

        <Show when={canGetModpack(props.snapshot) && offersClientPack(props.snapshot)}>
          <PlayOnServerCard snapshot={props.snapshot} />
        </Show>

        <Show when={props.snapshot.pack && !offersClientPack(props.snapshot) ? props.snapshot.pack : null}>
          {(pack) => (
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
          )}
        </Show>
      </section>

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
        <dt>{t('servers.overview.agent')}</dt><dd>{props.snapshot.info?.agentVersion ?? t('servers.unknown')}</dd>
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