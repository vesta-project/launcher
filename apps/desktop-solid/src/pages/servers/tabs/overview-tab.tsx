import { For, Show, createSignal } from 'solid-js';
import { Button, Dialog, toast } from '@vesta/ui';
import type { MessageId } from '../../../localization/messages';
import { errorMessage } from '../../../features/servers/errors';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { newIntentId } from '../../../features/servers/model';
import { serverCommand } from '../../../features/servers/store';
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

        <Show when={props.snapshot.pack}>
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

/** Publish the prepared pack, or require players to update to the hosted revision. */
function PackActions(props: { snapshot: ServerSnapshot }) {
  const [confirming, setConfirming] = createSignal(false, { name: 'server-pack:confirming' });
  const [busy, setBusy] = createSignal(false, { name: 'server-pack:busy' });
  const pack = () => props.snapshot.pack;
  const canPublish = () => gate(props.snapshot.capabilities, 'pack.publish') !== 'denied';
  const canRequire = () => gate(props.snapshot.capabilities, 'pack.force_update') !== 'denied'
    && !!pack()?.hostedRevision && pack()?.minimumRevision !== pack()?.hostedRevision;
  const run = async (work: () => Promise<unknown>, done: MessageId) => {
    setBusy(true);
    try { await work(); toast.show({ title: t(done), tone: 'neutral' }); }
    catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
    finally { setBusy(false); setConfirming(false); }
  };
  const id = () => props.snapshot.connection.id;
  return (
    <div data-vesta="server-stat-actions">
      <Show when={canPublish()}>
        <Button size="sm" variant="outline" disabled={busy()} onClick={() => void run(() => serverCommand((client) => client.packPublish(id(), pack()?.hostedRevision ?? '0', newIntentId())), 'servers.pack.published')}>
          {t('servers.pack.publish')}
        </Button>
      </Show>
      <Show when={canRequire()}>
        <Button size="sm" variant="ghost" disabled={busy()} onClick={() => setConfirming(true)}>{t('servers.pack.require')}</Button>
      </Show>
      <Dialog open={confirming()} onOpenChange={setConfirming} size="sm" title={t('servers.pack.require-title', { version: pack()?.hostedRevision ?? '' })} description={t('servers.pack.require-description')}
        footer={<><Button variant="ghost" onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={busy()} onClick={() => void run(() => serverCommand((client) => client.packMinimum(id(), pack()!.hostedRevision!, pack()!.hostedRevision!, newIntentId())), 'servers.pack.required')}>{t('servers.pack.require')}</Button></>}
      />
    </div>
  );
}
