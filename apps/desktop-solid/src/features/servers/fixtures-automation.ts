// Fixture workflows and run history for browser previews and checks. It keeps the
// agent's rules that matter to the UI: capability checks, the execution-principal rank
// rule, definition bounds, revisions, manual runs only for enabled manual workflows,
// one active run per workflow, suspended-only discard, intent replay and run history
// that outlives a deleted workflow.
import type { ConnectionId, ServerCommandError } from './native';
import type {
  ManualRunResult, Paged, RunDetail, RunStep, RunSummary, RunTrigger, WorkflowDefinition, WorkflowDetail, WorkflowDraft,
  WorkflowMutation, WorkflowStep, WorkflowSummary,
} from './native-automation';
import { draftProblems } from './automation-model';

export interface AutomationHost {
  server(id: ConnectionId): unknown;
  requireCapability(target: unknown, capability: string): void;
  wait(ms?: number): Promise<unknown>;
  /** The caller's principal and every principal's current rank. */
  principals(id: ConnectionId): Promise<{ selfId: string; ranks: Record<string, number> }>;
}

interface AutomationState {
  workflows: WorkflowDetail[];
  runs: RunDetail[];
  steps: RunStep[];
  receipts: Map<string, { payload: string; result: unknown }>;
  sequence: number;
}

const fail = (code: ServerCommandError['code']): never => { throw { code, retryAfterMs: null } satisfies ServerCommandError; };
const clone = <T,>(value: T): T => structuredClone(value);
const PAGE = 100;

function page<T>(items: readonly T[], cursorOf: (item: T) => string, after: string | null): Paged<T> {
  const start = after === null ? 0 : items.findIndex((item) => cursorOf(item) > after);
  const slice = start < 0 ? [] : items.slice(start, start + PAGE);
  return { items: clone(slice), nextAfter: slice.length === PAGE ? cursorOf(slice.at(-1)!) : null };
}

const stepDefaults = (step: Partial<WorkflowStep> & Pick<WorkflowStep, 'id' | 'action'>): WorkflowStep => ({
  timeoutSecs: 300, retries: { maxRetries: 0, backoffSecs: 0 }, onSuccess: { kind: 'next' }, onFailure: { kind: 'fail' }, ...step,
});

/** Riverside's owner set these up; Rae (a maintainer) owns the startup check. */
function seed(): AutomationState {
  const now = Date.now();
  const minute = 60_000;
  const day = 86_400_000;
  const state: AutomationState = { workflows: [], runs: [], steps: [], receipts: new Map(), sequence: 0 };
  const workflow = (name: string, principal: string, enabled: boolean, definition: WorkflowDefinition, ageDays: number): WorkflowDetail => {
    const created: WorkflowDetail = { id: `wf-${String(++state.sequence).padStart(4, '0')}`, name, enabled, executionPrincipalId: principal, createdAtMs: now - ageDays * day, updatedAtMs: now - (ageDays / 2) * day, revision: 3, definition };
    state.workflows.push(created);
    return created;
  };
  const nightly = workflow('Nightly backup & restart', 'p-self', true, {
    trigger: { kind: 'cron', expr: '0 4 * * *', utcOffsetMinutes: 600 },
    missedPolicy: { kind: 'run_latest' },
    steps: [
      stepDefaults({ id: 'warn-players', action: { kind: 'console_command', line: 'say The server restarts in 1 minute for the nightly backup.' }, timeoutSecs: 60 }),
      stepDefaults({ id: 'wait', action: { kind: 'delay', secs: 60 }, timeoutSecs: 120 }),
      stepDefaults({ id: 'backup', action: { kind: 'backup', profile: 'daily' }, timeoutSecs: 3600, retries: { maxRetries: 1, backoffSecs: 300 }, onFailure: { kind: 'goto', stepId: 'alert' } }),
      stepDefaults({ id: 'restart', action: { kind: 'restart' }, timeoutSecs: 600, onSuccess: { kind: 'end' } }),
      stepDefaults({ id: 'alert', action: { kind: 'notify', severity: 'critical', title: 'Nightly backup failed', body: "The nightly backup didn't finish, so the server wasn't restarted." }, timeoutSecs: 60 }),
    ],
  }, 30);
  const announce = workflow('Announce on first join', 'p-self', true, {
    trigger: { kind: 'first_player_joined' },
    missedPolicy: { kind: 'skip_and_notify' },
    steps: [stepDefaults({ id: 'welcome', action: { kind: 'console_command', line: 'say Welcome back! Backups run nightly at 04:00.' }, timeoutSecs: 60 })],
  }, 20);
  const wake = workflow('Wake-up check', 'p-rae', true, {
    trigger: { kind: 'agent_startup' },
    missedPolicy: { kind: 'skip_and_notify' },
    steps: [
      stepDefaults({ id: 'verify', action: { kind: 'verify_backup', profile: 'daily' }, timeoutSecs: 1800, onFailure: { kind: 'next' } }),
      stepDefaults({ id: 'report', action: { kind: 'notify', severity: 'info', title: 'Startup check finished', body: 'The latest daily backup was verified after the agent started.' }, timeoutSecs: 60 }),
    ],
  }, 12);
  const tidy = workflow('Empty file trash', 'p-self', true, {
    trigger: { kind: 'manual' },
    missedPolicy: { kind: 'skip_and_notify' },
    steps: [stepDefaults({ id: 'clean', action: { kind: 'clean_trash' }, timeoutSecs: 300 })],
  }, 6);
  workflow('Restart every 12 hours', 'p-self', false, {
    trigger: { kind: 'interval', seconds: 12 * 3600 },
    missedPolicy: { kind: 'skip_and_notify' },
    steps: [
      stepDefaults({ id: 'warn-players', action: { kind: 'console_command', line: 'say Restarting in 1 minute.' }, timeoutSecs: 60 }),
      stepDefaults({ id: 'wait', action: { kind: 'delay', secs: 60 }, timeoutSecs: 120 }),
      stepDefaults({ id: 'restart', action: { kind: 'restart' }, timeoutSecs: 600 }),
    ],
  }, 3);

  type Attempt = [index: number, state: string, extra?: Partial<RunStep>];
  const run = (source: WorkflowDetail | { id: string; definition: WorkflowDefinition; executionPrincipalId: string; revision: number }, trigger: RunTrigger, startedAtMs: number, outcome: { state: RunSummary['state']; code: string | null; finishedAfterMs: number | null }, attempts: Attempt[]) => {
    const id = `run-${String(++state.sequence).padStart(6, '0')}`;
    const last = attempts.at(-1);
    state.runs.push({
      id, workflowId: source.id, workflowRevision: source.revision, executionPrincipalId: source.executionPrincipalId, trigger,
      state: outcome.state, currentStep: last?.[0] ?? 0, attempt: last?.[2]?.attempt ?? 0, nextWakeAtMs: null, startedAtMs,
      finishedAtMs: outcome.finishedAfterMs === null ? null : startedAtMs + outcome.finishedAfterMs, outcomeCode: outcome.code, definition: clone(source.definition),
    });
    let at = startedAtMs;
    for (const [index, stepState, extra] of attempts) {
      const attempt = extra?.attempt ?? 0;
      const took = extra?.finishedAtMs ?? 20_000;
      state.steps.push({
        runId: id, index, attempt, cursor: String(index * 6 + attempt), state: stepState, operationReference: null, output: null, errorCode: null,
        ...extra, startedAtMs: at, finishedAtMs: stepState === 'waiting' || stepState === 'submitted' ? null : at + took,
      });
      at += took;
    }
  };
  const nightAt = (daysAgo: number) => {
    const date = new Date(now - daysAgo * day);
    date.setUTCHours(18, 0, 0, 0); // 04:00 at UTC+10:00
    return date.getTime();
  };
  // A night where everything went to plan, and the alert step was never needed.
  run(nightly, { kind: 'schedule', occurrenceMs: nightAt(3) }, nightAt(3) + 400, { state: 'succeeded', code: 'completed', finishedAfterMs: 4 * minute }, [
    [0, 'succeeded', { output: { stdin_written: true }, operationReference: 'op-7f21', finishedAtMs: 800 }],
    [1, 'succeeded', { finishedAtMs: 60_000 }],
    [2, 'succeeded', { output: { snapshot: '3f9c0e7a1b2d', files_changed: 412, data_added: 184_320_000 }, operationReference: 'job-b81c2a', finishedAtMs: 94_000 }],
    [3, 'succeeded', { output: { generation: '8c41d0aa' }, operationReference: 'op-7f40', finishedAtMs: 31_000 }],
  ]);
  // The disk filled up: one retry, then the failure branch alerted and the restart was skipped.
  run(nightly, { kind: 'schedule', occurrenceMs: nightAt(2) }, nightAt(2) + 300, { state: 'succeeded', code: 'completed', finishedAfterMs: 8 * minute }, [
    [0, 'succeeded', { output: { stdin_written: true }, finishedAtMs: 700 }],
    [1, 'succeeded', { finishedAtMs: 60_000 }],
    [2, 'failed', { errorCode: 'backup_disk_space_low', operationReference: 'job-c3a019', finishedAtMs: 4_000 }],
    [2, 'failed', { attempt: 1, errorCode: 'backup_disk_space_low', operationReference: 'job-c3a0ff', finishedAtMs: 4_000 }],
    [4, 'succeeded', { output: { notification: 'n-219' }, finishedAtMs: 200 }],
  ]);
  // The restart outlived its deadline; the run failed without cancelling the restart.
  run(nightly, { kind: 'schedule', occurrenceMs: nightAt(1) }, nightAt(1) + 500, { state: 'failed', code: 'timed_out', finishedAfterMs: 13 * minute }, [
    [0, 'succeeded', { output: { stdin_written: true }, finishedAtMs: 900 }],
    [1, 'succeeded', { finishedAtMs: 60_000 }],
    [2, 'succeeded', { output: { snapshot: '77ad01c4e9f0', files_changed: 208, data_added: 92_400_000 }, finishedAtMs: 88_000 }],
    [3, 'timed_out', { errorCode: 'timed_out', operationReference: 'op-81aa', finishedAtMs: 600_000 }],
  ]);
  run(announce, { kind: 'event', event: { kind: 'first_player_joined' } }, now - 2 * 3600_000, { state: 'succeeded', code: 'completed', finishedAfterMs: 1_000 }, [
    [0, 'succeeded', { output: { stdin_written: true }, operationReference: 'op-90b2', finishedAtMs: 600 }],
  ]);
  // Rae lost the backups capability, so the engine suspended the run until someone discards it.
  run(wake, { kind: 'event', event: { kind: 'agent_started' } }, now - 26 * minute, { state: 'suspended', code: 'authority_revoked', finishedAfterMs: null }, [
    [0, 'failed', { errorCode: 'forbidden', finishedAtMs: 300 }],
  ]);
  run(tidy, { kind: 'manual' }, now - 5 * day, { state: 'succeeded', code: 'completed', finishedAfterMs: 2_000 }, [
    [0, 'succeeded', { output: { removed: 14, freed_bytes: 52_428_800 }, finishedAtMs: 1_500 }],
  ]);
  // History kept from a workflow that was later deleted.
  run({ id: 'wf-0000', revision: 2, executionPrincipalId: 'p-self', definition: { trigger: { kind: 'cron', expr: '30 5 * * 0', utcOffsetMinutes: 600 }, missedPolicy: { kind: 'skip_and_notify' }, steps: [stepDefaults({ id: 'restart', action: { kind: 'restart' } })] } },
    { kind: 'schedule', occurrenceMs: now - 9 * day }, now - 9 * day, { state: 'succeeded', code: 'completed', finishedAfterMs: 40_000 }, [[0, 'succeeded', { finishedAtMs: 40_000 }]]);
  state.runs.sort((a, b) => (a.id < b.id ? -1 : 1));
  return state;
}

export function createAutomationFixtures(host: AutomationHost) {
  const states = new Map<ConnectionId, AutomationState>();
  const state = (id: ConnectionId) => {
    host.server(id);
    let value = states.get(id);
    if (!value) { value = id === 'fixture-survival' ? seed() : { workflows: [], runs: [], steps: [], receipts: new Map(), sequence: 0 }; states.set(id, value); }
    return value;
  };
  const view = (id: ConnectionId) => { host.requireCapability(host.server(id), 'automation.view'); return state(id); };
  const workflowOf = (current: AutomationState, workflowId: string) => current.workflows.find((entry) => entry.id === workflowId) ?? fail('not_found');
  const runOf = (current: AutomationState, runId: string) => current.runs.find((entry) => entry.id === runId) ?? fail('not_found');
  /** `automation.manage`, and every principal involved must rank below the caller unless it is the caller. */
  const authorize = async (id: ConnectionId, principals: string[]) => {
    host.requireCapability(host.server(id), 'automation.manage');
    const { selfId, ranks } = await host.principals(id);
    const own = ranks[selfId] ?? 0;
    for (const principal of principals) {
      if (principal === selfId) continue;
      const rank = ranks[principal] ?? fail('not_found');
      if (rank >= own) fail('forbidden');
    }
  };
  /** The same intent with the same body replays its first result; a changed body conflicts. */
  const receipt = async <T,>(current: AutomationState, intentId: string, payload: unknown, apply: () => Promise<T>): Promise<T> => {
    const body = JSON.stringify(payload);
    const known = current.receipts.get(intentId);
    if (known) { if (known.payload !== body) fail('conflict'); return clone(known.result) as T; }
    const result = await apply();
    current.receipts.set(intentId, { payload: body, result: clone(result) });
    return result;
  };
  const validate = (draft: WorkflowDraft) => { if (draftProblems(draft).length) fail('invalid_input'); };
  const summary = ({ definition: _definition, ...rest }: WorkflowDetail): WorkflowSummary => clone(rest);
  const runSummary = ({ definition: _definition, ...rest }: RunDetail): RunSummary => clone(rest);

  /** Plays a manual run forward: each step succeeds a moment later, following its branches. */
  const play = (current: AutomationState, run: RunDetail) => {
    const advance = (index: number) => {
      if (run.state !== 'running') return;
      const step = run.definition.steps[index];
      if (!step) { run.state = 'succeeded'; run.outcomeCode = 'completed'; run.finishedAtMs = Date.now(); return; }
      run.currentStep = index;
      const record: RunStep = { runId: run.id, index, attempt: 0, cursor: String(index * 6), state: 'submitted', operationReference: null, output: null, errorCode: null, startedAtMs: Date.now(), finishedAtMs: null };
      current.steps.push(record);
      setTimeout(() => {
        if (run.state !== 'running') return;
        record.state = 'succeeded';
        record.finishedAtMs = Date.now();
        record.output = step.action.kind === 'clean_trash' ? { removed: 3, freed_bytes: 1_048_576 } : step.action.kind === 'console_command' ? { stdin_written: true } : null;
        const branch = step.onSuccess;
        if (branch.kind === 'end') { run.state = 'succeeded'; run.outcomeCode = 'completed'; run.finishedAtMs = Date.now(); return; }
        const target = branch.kind === 'goto' ? run.definition.steps.findIndex((entry) => entry.id === branch.stepId) : index + 1;
        advance(target);
      }, step.action.kind === 'delay' ? Math.min(step.action.secs * 1000, 3000) : 900);
    };
    setTimeout(() => advance(0), 300);
  };

  return {
    async automationSelf(connectionId: ConnectionId) {
      await host.wait();
      host.server(connectionId);
      const { selfId, ranks } = await host.principals(connectionId);
      return { principalId: selfId, rank: ranks[selfId] ?? 0 };
    },
    async automationWorkflows(connectionId: ConnectionId, after: string | null): Promise<Paged<WorkflowSummary>> {
      await host.wait();
      const current = view(connectionId);
      const listed = page(current.workflows, (entry) => entry.id, after);
      return { items: listed.items.map(summary), nextAfter: listed.nextAfter };
    },
    async automationWorkflow(connectionId: ConnectionId, workflowId: string): Promise<WorkflowDetail> {
      await host.wait();
      return clone(workflowOf(view(connectionId), workflowId));
    },
    async automationWorkflowCreate(connectionId: ConnectionId, draft: WorkflowDraft, enabled: boolean, intentId: string): Promise<WorkflowMutation> {
      await host.wait();
      const current = state(connectionId);
      return receipt(current, intentId, { draft, enabled }, async () => {
        await authorize(connectionId, [draft.executionPrincipalId]);
        validate(draft);
        if (current.workflows.length >= 128) fail('conflict');
        const now = Date.now();
        const created: WorkflowDetail = { id: `wf-${String(++current.sequence).padStart(4, '0')}`, name: draft.name, enabled, executionPrincipalId: draft.executionPrincipalId, createdAtMs: now, updatedAtMs: now, revision: 1, definition: clone(draft.definition) };
        current.workflows.push(created);
        return { workflowId: created.id, revision: created.revision };
      });
    },
    async automationWorkflowUpdate(connectionId: ConnectionId, workflowId: string, expectedRevision: number, draft: WorkflowDraft, intentId: string): Promise<WorkflowMutation> {
      await host.wait();
      const current = state(connectionId);
      return receipt(current, intentId, { workflowId, expectedRevision, draft }, async () => {
        const target = workflowOf(view(connectionId), workflowId);
        await authorize(connectionId, [target.executionPrincipalId, draft.executionPrincipalId]);
        if (target.revision !== expectedRevision) fail('stale_target');
        validate(draft);
        Object.assign(target, { name: draft.name, executionPrincipalId: draft.executionPrincipalId, definition: clone(draft.definition), revision: target.revision + 1, updatedAtMs: Date.now() });
        return { workflowId, revision: target.revision };
      });
    },
    async automationWorkflowDelete(connectionId: ConnectionId, workflowId: string, expectedRevision: number, intentId: string): Promise<void> {
      await host.wait();
      const current = state(connectionId);
      await receipt(current, intentId, { workflowId, expectedRevision, delete: true }, async () => {
        const target = workflowOf(view(connectionId), workflowId);
        await authorize(connectionId, [target.executionPrincipalId]);
        if (target.revision !== expectedRevision) fail('stale_target');
        current.workflows = current.workflows.filter((entry) => entry !== target);
        // Pinned history stays; only runs still waiting in the queue are failed.
        for (const run of current.runs) if (run.workflowId === workflowId && run.state === 'queued') Object.assign(run, { state: 'failed', outcomeCode: 'workflow_deleted', finishedAtMs: Date.now() });
        return null;
      });
    },
    async automationWorkflowSetEnabled(connectionId: ConnectionId, workflowId: string, expectedRevision: number, enabled: boolean, intentId: string): Promise<WorkflowMutation> {
      await host.wait();
      const current = state(connectionId);
      return receipt(current, intentId, { workflowId, expectedRevision, enabled }, async () => {
        const target = workflowOf(view(connectionId), workflowId);
        await authorize(connectionId, [target.executionPrincipalId]);
        if (target.revision !== expectedRevision) fail('stale_target');
        Object.assign(target, { enabled, revision: target.revision + 1, updatedAtMs: Date.now() });
        return { workflowId, revision: target.revision };
      });
    },
    async automationWorkflowRun(connectionId: ConnectionId, workflowId: string, intentId: string): Promise<ManualRunResult> {
      await host.wait();
      const current = state(connectionId);
      return receipt(current, intentId, { workflowId, run: true }, async () => {
        const target = workflowOf(view(connectionId), workflowId);
        await authorize(connectionId, [target.executionPrincipalId]);
        if (!target.enabled || target.definition.trigger.kind !== 'manual') fail('conflict');
        if (current.runs.some((run) => run.workflowId === workflowId && (run.state === 'running' || run.state === 'suspended'))) return { workflowId, runId: null, skipped: true };
        const run: RunDetail = {
          id: `run-${String(++current.sequence).padStart(6, '0')}`, workflowId, workflowRevision: target.revision, executionPrincipalId: target.executionPrincipalId,
          trigger: { kind: 'manual' }, state: 'running', currentStep: 0, attempt: 0, nextWakeAtMs: null, startedAtMs: Date.now(), finishedAtMs: null, outcomeCode: null,
          definition: clone(target.definition),
        };
        current.runs.push(run);
        play(current, run);
        return { workflowId, runId: run.id, skipped: false };
      });
    },
    async automationWorkflowRuns(connectionId: ConnectionId, workflowId: string, after: string | null): Promise<Paged<RunSummary>> {
      await host.wait();
      const current = view(connectionId);
      const listed = page(current.runs.filter((run) => run.workflowId === workflowId), (run) => run.id, after);
      return { items: listed.items.map(runSummary), nextAfter: listed.nextAfter };
    },
    async automationRuns(connectionId: ConnectionId, after: string | null): Promise<Paged<RunSummary>> {
      await host.wait();
      const listed = page(view(connectionId).runs, (run) => run.id, after);
      return { items: listed.items.map(runSummary), nextAfter: listed.nextAfter };
    },
    async automationRun(connectionId: ConnectionId, runId: string): Promise<RunDetail> {
      await host.wait();
      return clone(runOf(view(connectionId), runId));
    },
    async automationRunSteps(connectionId: ConnectionId, runId: string, after: string | null): Promise<Paged<RunStep>> {
      await host.wait();
      const current = view(connectionId);
      runOf(current, runId);
      const own = current.steps.filter((step) => step.runId === runId).sort((a, b) => Number(a.cursor) - Number(b.cursor));
      const start = after === null ? 0 : own.findIndex((step) => Number(step.cursor) > Number(after));
      const slice = start < 0 ? [] : own.slice(start, start + PAGE);
      return { items: clone(slice), nextAfter: slice.length === PAGE ? slice.at(-1)!.cursor : null };
    },
    async automationRunDiscard(connectionId: ConnectionId, runId: string, intentId: string): Promise<void> {
      await host.wait();
      const current = state(connectionId);
      await receipt(current, intentId, { runId, discard: true }, async () => {
        const run = runOf(view(connectionId), runId);
        await authorize(connectionId, [run.executionPrincipalId]);
        if (run.state !== 'suspended') fail('conflict');
        Object.assign(run, { state: 'failed', outcomeCode: 'discarded', finishedAtMs: Date.now() });
        return null;
      });
    },
  };
}
