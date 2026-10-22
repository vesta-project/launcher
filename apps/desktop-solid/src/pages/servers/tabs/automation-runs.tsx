import { Badge, Button, toast } from '@vesta/ui';
import { For, Show, createEffect, createSignal, onSettled } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { gate } from '../../../features/servers/capabilities';
import { errorMessage } from '../../../features/servers/errors';
import { age, newIntentId } from '../../../features/servers/model';
import {
  duration, outputPreview, runTriggerSentence, runsNewestFirst, stepRows, stepSummary, type StepRow,
} from '../../../features/servers/automation-model';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { RunDetail, RunSummary } from '../../../features/servers/native-automation';
import { ServerErrorNote } from '../parts';
import { collectPages, formatDateTime, outcomeText, runState, stepState } from './automation-shared';

const elapsed = (seconds: number) => {
  const unit = duration(Math.max(1, Math.round(seconds)));
  if (unit.message === 'server-automation.duration-seconds' && seconds >= 120) return t('server-automation.duration-minutes', { count: Math.round(seconds / 60) });
  return t(unit.message, { count: unit.count });
};

/**
 * Run history, newest first: every workflow's (`workflowId` absent) or one workflow's.
 * `reload` changes when the caller wants a fresh read.
 */
export function RunList(props: { snapshot: ServerSnapshot; workflowId?: string; names: (workflowId: string) => string | null; reload: number }) {
  const id = () => props.snapshot.connection.id;
  const [runs, setRuns] = createSignal<RunSummary[] | null>(null, { name: 'server-automation-runs:list' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-automation-runs:error' });
  const [open, setOpen] = createSignal<string | null>(null, { name: 'server-automation-runs:open' });
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  onSettled(() => () => { disposed = true; clearTimeout(timer); });

  const load = async () => {
    clearTimeout(timer);
    setError(null);
    try {
      const workflowId = props.workflowId;
      const all = await collectPages((after) => serverCommand((client) => (workflowId ? client.automationWorkflowRuns(id(), workflowId, after) : client.automationRuns(id(), after))));
      if (disposed) return;
      const sorted = runsNewestFirst(all);
      setRuns(sorted);
      // Follow runs that are still moving; suspended runs wait for a person.
      if (sorted.some((run) => run.state === 'running' || run.state === 'queued')) timer = setTimeout(() => void load(), 2500);
    } catch (reason) { if (!disposed) setError(reason as ServerCommandError); }
  };
  createEffect(() => props.reload, () => { void load(); }, { name: 'server-automation-runs:load' });

  return (
    <>
      <ServerErrorNote error={error()} onRetry={() => void load()} />
      <Show when={runs()} fallback={<Show when={!error()}><p data-vesta="server-muted">{t('servers.loading')}</p></Show>}>
        {(list) => (
          <Show when={list().length} fallback={<p data-vesta="server-muted">{t('server-automation.runs-empty')}</p>}>
            <ul data-vesta="server-activity-list" aria-label={t('server-automation.runs')}>
              <For each={list()} keyed={(run) => run.id}>
                {(run) => (
                  <RunRow snapshot={props.snapshot} run={run()} name={props.names(run().workflowId)} showName={!props.workflowId}
                    open={open() === run().id} onToggle={() => setOpen(open() === run().id ? null : run().id)} onChanged={() => void load()} />
                )}
              </For>
            </ul>
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
        <Icon name={props.run.state === 'suspended' ? 'icons/controls/warning' : 'icons/content/timer'} size={14} />
      </span>
      <div data-vesta="server-activity-body">
        <p data-vesta="server-activity-line">
          <Show when={props.showName}>
            <strong>{props.name ?? t('server-automation.deleted-workflow')}</strong>{' · '}
          </Show>
          {t(trigger().message, { ...trigger().args })}
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
  const id = () => props.snapshot.connection.id;
  const [detail, setDetail] = createSignal<{ run: RunDetail; rows: StepRow[] } | null>(null, { name: 'server-automation-run:detail' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-automation-run:error' });
  const [busy, setBusy] = createSignal(false, { name: 'server-automation-run:busy' });
  const canManage = () => gate(props.snapshot.capabilities, 'automation.manage') !== 'denied';
  const load = async () => {
    setError(null);
    try {
      const runId = props.run.id;
      const [run, attempts] = await Promise.all([
        serverCommand((client) => client.automationRun(id(), runId)),
        collectPages((after) => serverCommand((client) => client.automationRunSteps(id(), runId, after))),
      ]);
      setDetail({ run, rows: stepRows(run, attempts) });
    } catch (reason) { setError(reason as ServerCommandError); }
  };
  createEffect(() => `${props.run.id}:${props.run.state}:${props.run.currentStep}:${props.run.attempt}`, () => { void load(); }, { name: 'server-automation-run:load' });
  const discard = async () => {
    setBusy(true);
    try {
      await serverCommand((client) => client.automationRunDiscard(id(), props.run.id, newIntentId()));
      toast.show({ title: t('server-automation.discarded'), tone: 'neutral' });
      props.onChanged();
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
    finally { setBusy(false); }
  };
  return (
    <div data-vesta="server-automation-run-detail">
      <ServerErrorNote error={error()} onRetry={() => void load()} />
      <Show when={props.run.state === 'suspended'}>
        <div data-vesta="server-callout" data-tone="warning" role="status">
          <p>{t('server-automation.suspended-note')}</p>
          <Show when={canManage()}>
            <Button size="sm" variant="outline" tone="danger" disabled={busy()} onClick={() => void discard()}>{t('server-automation.discard-run')}</Button>
          </Show>
        </div>
      </Show>
      <Show when={detail()} fallback={<Show when={!error()}><p data-vesta="server-muted">{t('servers.loading')}</p></Show>}>
        {(current) => (
          <ol data-vesta="server-automation-run-steps">
            <For each={current().rows}>
              {(row) => {
                const summary = () => (row.step ? stepSummary(row.step.action) : null);
                const tone = () => stepState(row.state);
                return (
                  <li data-state={row.state}>
                    <span data-vesta="server-automation-step-index">{row.index + 1}</span>
                    <div data-vesta="server-automation-run-step-body">
                      <p>
                        <Show when={summary()} fallback={t('server-automation.unknown-step')}>
                          {(text) => <span>{t(text().message, { ...text().args, ...(text().duration ? { time: t(text().duration!.message, { count: text().duration!.count }) } : {}) })}</span>}
                        </Show>
                        <Show when={row.step}>{(step) => <code data-vesta="server-automation-step-id">{step().id}</code>}</Show>
                      </p>
                      <p data-vesta="server-activity-meta">
                        <Show when={row.attempts.length > 1}><span>{t('server-automation.attempts', { count: row.attempts.length })}</span></Show>
                        <Show when={row.latest?.finishedAtMs}>{(finished) => <span>{t('server-automation.took', { time: elapsed((finished() - row.latest!.startedAtMs) / 1000) })}</span>}</Show>
                        <Show when={row.latest?.errorCode}>{(code) => <span data-vesta="server-automation-error">{outcomeText(code())}</span>}</Show>
                        <Show when={row.latest?.operationReference}>{(reference) => <span>{t('server-automation.operation', { name: reference() })}</span>}</Show>
                      </p>
                      <Show when={outputPreview(row.latest?.output)}>{(preview) => <code data-vesta="server-automation-output">{preview()}</code>}</Show>
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

