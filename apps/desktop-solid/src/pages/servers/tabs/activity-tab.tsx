import { Badge, Button, SegmentedControl } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import type { Tone } from '@vesta/ui';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { age } from '../../../features/servers/model';
import { activityPageRows, describeOperation, isTerminal, operationStateMessage } from '../../../features/servers/operations-model';
import { serverOperations, useServersClock } from '../../../features/servers/store';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { useServerResource } from '../../../features/servers/resources';
import { operationsResource, operationHistoryResource } from '../../../features/servers/server-resources';
import type { ServerOperation, ServerSnapshot } from '../../../features/servers/native';
import { ServerErrorNote } from '../parts';

const stateTone = (operation: ServerOperation): Tone => {
  if (operation.reconciling) return 'warning';
  switch (operation.state) {
    case 'succeeded': return 'success';
    case 'failed':
    case 'recovery_required': return 'danger';
    case 'cancelled': return 'neutral';
    default: return 'accent';
  }
};

/** One task: who did what, exactly, from where and when, and how it ended. */
export function ActivityRow(props: { operation: ServerOperation; now: number; compact?: boolean }) {
  const description = () => describeOperation(props.operation);
  const when = () => age(props.operation.createdAtMs, props.now);
  const actorName = () => t(description().actor.message, description().actor.args);
  const automated = () => props.operation.actor?.kind === 'workflow' || props.operation.actor?.kind === 'system';
  const action = () => {
    const current = description();
    const args = { ...current.action.args, ...(current.duration ? { time: t(current.duration.message, { count: current.duration.count }) } : {}) };
    return t(current.action.message, args);
  };
  return (
    <li data-vesta="server-activity-row" data-state={props.operation.state} data-compact={props.compact ? '' : undefined}>
      <span data-vesta="server-activity-avatar" data-automated={automated() ? '' : undefined} aria-hidden="true">
        <Show when={!automated()} fallback={<Icon name="icons/content/timer" size={14} />}>
          {actorName().slice(0, 1).toUpperCase()}
        </Show>
      </span>
      <div data-vesta="server-activity-body">
        <p data-vesta="server-activity-line">
          <strong>{actorName()}</strong> {action()}
        </p>
        <Show when={description().command}>
          {(command) => <code data-vesta="server-activity-command">{command()}</code>}
        </Show>
        <Show when={description().detail}>
          {(detail) => <p data-vesta="server-activity-detail">“{detail()}”</p>}
        </Show>
        <p data-vesta="server-activity-meta">
          <span>{t('servers.ago', { time: t(when().message, { count: when().count }) })}</span>
          <Show when={description().device}>{(device) => <span>{device()}</span>}</Show>
          <Show when={description().outcome}>{(outcome) => <span>{t(outcome())}</span>}</Show>
        </p>
      </div>
      <Badge size="sm" tone={stateTone(props.operation)} variant="soft">{t(operationStateMessage(props.operation))}</Badge>
    </li>
  );
}

export function ActivityTab(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const id = () => props.snapshot.connection.id;
  const [filter, setFilter] = createSignal<'all' | 'mine'>('all', { name: 'server-activity:filter' });
  // Shared with Overview: switching between them reuses the read; the topic keeps it live.
  const tasks = useServerResource(stableConnectionId(() => props.snapshot), operationsResource);
  const [cursors, setCursors] = createSignal<string[]>([], { name: 'server-activity:cursors' });
  const cursor = () => cursors().at(-1);
  const history = useServerResource(stableConnectionId(() => props.snapshot), operationHistoryResource, {
    args: () => cursor()!, enabled: () => !!cursor(),
  });
  const page = () => cursor() ? history.value() : tasks.value();
  const refreshing = () => cursor() ? history.refreshing() : tasks.refreshing();
  const loading = () => cursor() ? history.loading() : tasks.loading();
  const refresh = () => cursor() ? history.refresh() : tasks.refresh();
  const visible = () => [...new Map([
    ...activityPageRows(page()?.items ?? [], serverOperations(id()), !cursor()),
    ...serverOperations(id()).filter(operation => !isTerminal(operation) || operation.reconciling),
  ].map(operation => [operation.operationId, operation])).values()].filter((operation) =>
    filter() === 'all' || operation.actor?.kind === 'principal' && operation.actor.self)
    .toSorted((a,b) => Number(!isTerminal(b) || !!b.reconciling) - Number(!isTerminal(a) || !!a.reconciling));

  return (
    <div data-vesta="server-activity">
      <div data-vesta="pane-toolbar">
        <SegmentedControl
          size="md"
          aria-label={t('servers.activity.filter')}
          value={filter()}
          onChange={(value) => setFilter(value as 'all' | 'mine')}
          options={[
            { value: 'all', label: t('servers.activity.all') },
            { value: 'mine', label: t('servers.activity.mine') },
          ]}
        />
        <span data-vesta="server-toolbar-spacer" />
        <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/refresh" />} disabled={refreshing()} onClick={() => void refresh()}>{t('servers.refresh')}</Button>
      </div>
      <div data-vesta="server-pane-body">
        <ServerErrorNote error={cursor() ? history.error() : tasks.error()} onRetry={() => void refresh()} />
        <Show when={visible().length > 0} fallback={<p data-vesta="server-muted">{loading() ? t('servers.loading') : t('servers.activity.empty')}</p>}>
          <ul data-vesta="server-activity-list" aria-label={t('servers.tab.activity')}>
            <For each={visible()} keyed={(operation) => operation.operationId}>
              {(operation) => <ActivityRow operation={operation()} now={now()} />}
            </For>
          </ul>
        </Show>
        <div data-vesta="server-backup-actions" aria-label={t('servers.activity.pages')}>
          <Show when={cursors().length}><Button size="sm" variant="outline" disabled={refreshing()} onClick={() => setCursors((items) => items.slice(0, -1))}>{t('servers.activity.newer')}</Button></Show>
          <Show when={page()?.nextCursor}><Button size="sm" variant="outline" disabled={refreshing()} onClick={() => { const next = page()?.nextCursor; if (next && next !== cursor()) setCursors((items) => [...items, next]); }}>{t('servers.activity.older')}</Button></Show>
        </div>
      </div>
    </div>
  );
}
