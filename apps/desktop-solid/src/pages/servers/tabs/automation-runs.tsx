import { Badge, Button, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, untrack, type Accessor } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { duration, mergeRunPages, outputFields, pollRunsAfter, RUN_POLL_MS, runTriggerSentence, shownRunDetail, startRunPoll } from '../../../features/servers/automation-model';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import { age, newIntentId } from '../../../features/servers/model';
import { invalidateServerResources, readServerResource, serverPressure, useServerResource, type ServerResourceState } from '../../../features/servers/resources';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import type { ConnectionId, ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { Paged, RunSummary } from '../../../features/servers/native-automation';
import { ServerErrorNote } from '../parts';
import { runPageResource, runStepsResource } from '../automation/resources';
import { actionIcons, formatDateTime, outcomeText, runState, stepState, stepText } from './automation-shared';

const elapsed = (seconds: number) => {
  const unit = duration(Math.max(1, Math.round(seconds)));
  if (unit.message === 'server-automation.duration-seconds' && seconds >= 120) return t('server-automation.duration-minutes', { count: Math.round(seconds / 60) });
  return t(unit.message, { count: unit.count });
};

/**
 * Follows a page of runs while something in it is running or queued, and only while
 * `active` (the view is on screen). One timer per page; it waits out server pressure and a
 * hidden window, backs off after transient failures and stops for lasting ones.
 */
export function useRunPolling(id: Accessor<ConnectionId>, page: ServerResourceState<Paged<RunSummary>>, active: Accessor<boolean>) {
  createEffect(() => active() && pollRunsAfter(page.value()?.items) !== null, (moving) => {
    if (!moving) return;
    return startRunPoll({
      refresh: page.refresh,
      current: () => untrack(() => ({ runs: page.value()?.items, error: page.error() })),
      holdFor: () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return RUN_POLL_MS;
        const pressure = serverPressure(untrack(id));
        return pressure ? pressure.untilMs - Date.now() : 0;
      },
    });
  }, { name: 'server-automation-runs:poll' });
}

/**
 * Run history, newest first: every workflow's (`workflowId` absent) or one workflow's. One
 * page is read; older runs load only when asked for.
 */
export function RunList(props: { snapshot: ServerSnapshot; workflowId?: string; names: (workflowId: string) => string | null }) {
  const id = stableConnectionId(() => props.snapshot);
  const scope = createMemo(() => props.workflowId ?? null, { name: 'server-automation-runs:scope' });
  const first = useServerResource(id, runPageResource, { args: () => ({ workflowId: scope(), after: null }) });
  useRunPolling(id, first, () => true);
  const [older, setOlder] = createSignal<RunSummary[][]>([], { name: 'server-automation-runs:older' });
  const [cursor, setCursor] = createSignal<string | null | undefined>(undefined, { name: 'server-automation-runs:cursor' });
  const [loadingOlder, setLoadingOlder] = createSignal(false, { name: 'server-automation-runs:loading-older' });
  const [olderError, setOlderError] = createSignal<ServerCommandError | null>(null, { name: 'server-automation-runs:older-error' });
  const [open, setOpen] = createSignal<string | null>(null, { name: 'server-automation-runs:open' });
  const runs = createMemo(() => {
    const head = first.value();
    return head ? mergeRunPages([head.items, ...older()]) : null;
  }, { name: 'server-automation-runs:list' });
  /** Where the next older page starts: the last page read, or the first page's cursor. */
  const next = () => (cursor() === undefined ? first.value()?.nextAfter ?? null : cursor()!);
  const loadOlder = async () => {
    const after = next();
    if (!after) return;
    setLoadingOlder(true); setOlderError(null);
    try {
      const page = await readServerResource(id(), runPageResource, { workflowId: scope(), after });
      setOlder((pages) => [...pages, page.items]);
      setCursor(page.nextAfter);
    } catch (reason) { setOlderError(reason as ServerCommandError); }
    finally { setLoadingOlder(false); }
  };
  const changed = () => invalidateServerResources(id(), [runPageResource.name]);

  return (
    <>
      <ServerErrorNote error={first.error()} onRetry={() => void first.refresh()} />
      <Show when={runs()} fallback={<Show when={!first.error()}><p data-vesta="server-muted">{t('servers.loading')}</p></Show>}>
        {(list) => (
          <Show when={list().length} fallback={<p data-vesta="server-muted">{t('server-automation.runs-empty')}</p>}>
            <ul data-vesta="server-activity-list" aria-label={t('server-automation.runs')}>
              <For each={list()} keyed={(run) => run.id}>
                {(run) => (
                  <RunRow snapshot={props.snapshot} run={run()} name={props.names(run().workflowId)} showName={!props.workflowId}
                    open={open() === run().id} onToggle={() => setOpen(open() === run().id ? null : run().id)} onChanged={changed} />
                )}
              </For>
            </ul>
            <ServerErrorNote error={olderError()} onRetry={() => void loadOlder()} />
            <Show when={next()}>
              <div data-vesta="server-automation-more">
                <Button variant="ghost" disabled={loadingOlder()} onClick={() => void loadOlder()}>{t('server-automation.load-older')}</Button>
              </div>
            </Show>
          </Show>
        )}
      </Show>
    </>
  );
}

function RunRow(props: { snapshot: ServerSnapshot; run: RunSummary; name: string | null; showName: boolean; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const now = useServersClock();
  const state = () => runState(props.run.state);
  const trigger = () => runTriggerSentence(props.run.trigger, formatDateTime);
  const started = () => age(props.run.startedAtMs, now());
  return (
    <li data-vesta="server-activity-row" data-state={props.run.state} data-automation-run>
      <span data-vesta="server-activity-avatar" data-automated aria-hidden="true">
        <Icon name={props.run.state === 'suspended' ? 'icons/controls/warning' : props.run.trigger.kind === 'manual' ? 'icons/actions/play' : 'icons/content/timer'} size={14} />
      </span>
      <div data-vesta="server-activity-body">
        <p data-vesta="server-activity-line" style={{ display: 'flex', gap: 'var(--vesta-space-2)', 'flex-wrap': 'wrap' }}>
          <Show when={props.showName}>
            <strong>{props.name ?? t('server-automation.deleted-workflow')}</strong>
          </Show>
          <span>{t(trigger().message, { ...trigger().args })}</span>
        </p>
        <p data-vesta="server-activity-meta">
          <span title={formatDateTime(props.run.startedAtMs)}>{t('servers.ago', { time: t(started().message, { count: started().count }) })}</span>
          <Show when={props.run.finishedAtMs}>{(finished) => <span>{t('server-automation.took', { time: elapsed((finished() - props.run.startedAtMs) / 1000) })}</span>}</Show>
          <Show when={props.run.outcomeCode}>{(code) => <span>{outcomeText(code())}</span>}</Show>
          <Show when={props.run.nextWakeAtMs}>{(wake) => <span>{t('server-automation.wakes', { time: formatDateTime(wake()) })}</span>}</Show>
        </p>
        <div>
          <Button size="sm" variant="ghost" aria-expanded={props.open ? 'true' : 'false'} icon={<Icon name={props.open ? 'icons/controls/chevron-up' : 'icons/controls/chevron-down'} />} onClick={() => props.onToggle()}>
            {t(props.open ? 'server-automation.hide-steps' : 'server-automation.show-steps')}
          </Button>
        </div>
        <Show when={props.open}>
          <RunSteps snapshot={props.snapshot} run={props.run} onChanged={props.onChanged} />
        </Show>
      </div>
      <Badge size="sm" variant="soft" tone={state().tone}>{t(state().message)}</Badge>
    </li>
  );
}

/** The pinned definition joined with each recorded attempt; unreached steps read "Skipped". */
function RunSteps(props: { snapshot: ServerSnapshot; run: RunSummary; onChanged: () => void }) {
  const id = stableConnectionId(() => props.snapshot);
  const [busy, setBusy] = createSignal(false, { name: 'server-automation-run:busy' });
  const canManage = () => gate(props.snapshot.capabilities, 'automation.manage') !== 'denied';
  // Re-read only when the run moves on (state, step or attempt); the history poll notices that.
  const detail = useServerResource(id, runStepsResource, {
    args: () => ({ runId: props.run.id, progress: `${props.run.state}:${props.run.currentStep}:${props.run.attempt}` }),
  });
  // Each progress key is its own cached read, so a slower earlier answer can never replace a
  // newer one; while the newer one loads, the last detail of this run stays on screen.
  const shown = createMemo<ReturnType<typeof detail.value>>((previous) => shownRunDetail(previous, detail.value(), props.run.id), { name: 'server-automation-run:shown' });
  const discard = async () => {
    setBusy(true);
    const connection = id();
    const runId = props.run.id;
    const intent = newIntentId();
    try {
      await serverCommand((client) => client.automationRunDiscard(connection, runId, intent));
      toast.show({ title: t('server-automation.discarded'), tone: 'neutral' });
      props.onChanged();
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
    finally { setBusy(false); }
  };
  return (
    <div data-vesta="server-automation-run-detail">
      <ServerErrorNote error={detail.error()} onRetry={() => void detail.refresh()} />
      <Show when={props.run.state === 'suspended'}>
        <div data-vesta="server-callout" data-tone="warning" role="status">
          <p>{t('server-automation.suspended-note')}</p>
          <Show when={canManage()}>
            <Button size="sm" variant="outline" tone="danger" disabled={busy()} onClick={() => void discard()}>{t('server-automation.discard-run')}</Button>
          </Show>
        </div>
      </Show>
      <Show when={shown()} fallback={<Show when={!detail.error()}><p data-vesta="server-muted">{t('servers.loading')}</p></Show>}>
        {(current) => (
          <ol data-vesta="server-automation-run-steps">
            <For each={current().rows}>
              {(row) => {
                const tone = () => stepState(row.state);
                return (
                  <li data-state={row.state}>
                    <span data-vesta="server-automation-step-index">{row.index + 1}</span>
                    <span data-vesta="server-automation-step-kind" aria-hidden="true"><Icon name={row.step ? actionIcons[row.step.action.kind] ?? 'icons/content/list' : 'icons/content/help'} size={14} /></span>
                    <div data-vesta="server-automation-run-step-body">
                      <p>{row.step ? stepText(row.step.action) : t('server-automation.unknown-step')}</p>
                      <p data-vesta="server-activity-meta">
                        <Show when={row.attempts.length > 1}><span>{t('server-automation.attempts', { count: row.attempts.length })}</span></Show>
                        <Show when={row.latest?.finishedAtMs}>{(finished) => <span>{t('server-automation.took', { time: elapsed((finished() - row.latest!.startedAtMs) / 1000) })}</span>}</Show>
                        <Show when={row.latest?.errorCode}>{(code) => <span data-vesta="server-automation-error">{outcomeText(code())}</span>}</Show>
                        <Show when={row.latest?.operationReference}>{(reference) => <span>{t('server-automation.operation', { name: reference() })}</span>}</Show>
                      </p>
                      <Show when={outputFields(row.latest?.output)}>
                        {(fields) => (
                          <dl data-vesta="server-automation-output">
                            <For each={fields()}>
                              {(field) => (
                                <div>
                                  <Show when={field.label}><dt>{field.label}</dt></Show>
                                  <dd>{typeof field.value === 'boolean' ? t(field.value ? 'server-automation.output-yes' : 'server-automation.output-no') : field.value}</dd>
                                </div>
                              )}
                            </For>
                          </dl>
                        )}
                      </Show>
                    </div>
                    <Badge size="sm" variant="soft" tone={tone().tone}>{t(tone().message)}</Badge>
                  </li>
                );
              }}
            </For>
          </ol>
        )}
      </Show>
    </div>
  );
}
