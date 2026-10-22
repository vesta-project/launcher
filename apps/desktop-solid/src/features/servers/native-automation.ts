// Contract for server automation: durable workflows (a trigger, then 1–32 sequential
// steps with success/failure branches) and their pinned run history. Maps to the agent
// management API §4A "Workflow requests and durable mutation results", all under
// `/api/v3/manage`. Same rules as `native.ts`: camelCase DTOs (native renames the agent's
// snake_case fields, including inside definitions), opaque ids and cursors stay strings,
// mutations take a UI `intentId` that native turns into the Idempotency-Key.
//
// Capabilities: reads need `automation.view`; mutations need `automation.manage`, and
// acting for an execution principal other than yourself also needs that principal's
// current rank to be strictly below yours.
//
// Error mapping onto the closed codes:
// - 412 `precondition_failed` (stale `expected_revision`) → `stale_target`.
// - 409 `automation_conflict` (manual run of a disabled or non-manual workflow, discard of
//   a run that is not suspended) and 409 `idempotency_conflict` → `conflict`.
// - 400 `invalid_request` (definition outside the bounds) → `invalid_input`.
// - 404 `resource_not_found` → `not_found`; 403 → `forbidden`;
//   503 `temporarily_unavailable` (receipt or capacity saturation) → `server_busy`.
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

// ---------------------------------------------------------------- definitions

/** Triggers without parameters. */
export const EVENT_TRIGGERS = [
  'manual', 'agent_startup', 'server_started', 'server_stopped', 'server_crashed',
  'player_count_zero', 'first_player_joined', 'update_available',
] as const;
export type EventTriggerKind = (typeof EVENT_TRIGGERS)[number];

export type WorkflowTrigger =
  | { kind: EventTriggerKind }
  /** Numeric five-field cron at a fixed UTC offset (-840..840 minutes); no host time zone or DST. */
  | { kind: 'cron'; expr: string; utcOffsetMinutes: number }
  /** 60–31,536,000 seconds. */
  | { kind: 'interval'; seconds: number }
  /** `profile: null` matches every backup profile. */
  | { kind: 'backup_completed' | 'backup_failed'; profile: string | null };
export type TriggerKind = WorkflowTrigger['kind'];

export type MissedPolicy =
  | { kind: 'skip_and_notify' | 'run_latest' }
  /** Queue up to `max` (1–10) missed occurrences, run one after another. */
  | { kind: 'catch_up'; max: number };

export type NotifySeverity = 'info' | 'warning' | 'critical';

export type WorkflowAction =
  /** 1–86,400 seconds, durable across agent restarts. */
  | { kind: 'delay'; secs: number }
  | { kind: 'backup' | 'verify_backup'; profile: string }
  | { kind: 'start' | 'stop' | 'restart' | 'clean_trash' }
  /** One console line: no control characters, at most 1,024 bytes. Not shell text. */
  | { kind: 'console_command'; line: string }
  /** Title ≤256 bytes, body ≤4,096 bytes. */
  | { kind: 'notify'; severity: NotifySeverity; title: string; body: string }
  /** An owner-approved preset; at most 32 params, keys ≤64 and values ≤2,048 bytes. */
  | { kind: 'script_preset'; preset: string; params: Record<string, string> };
export type ActionKind = WorkflowAction['kind'];

export type SuccessBranch =
  | { kind: 'next' | 'end' }
  /** Forward only: the target must be a later step. */
  | { kind: 'goto'; stepId: string }
  /** Read-only here: authored by other clients; preserved unchanged when editing. */
  | { kind: 'if_output_equals'; key: string; value: unknown; thenStep: string; otherwise: string | null };

export type FailureBranch = { kind: 'fail' | 'next' } | { kind: 'goto'; stepId: string };

export interface WorkflowStep {
  /** Unique, nonblank, control-free, ≤128 bytes. */
  id: string;
  action: WorkflowAction;
  /** 1–86,400 seconds. Timeouts fail the step without cancelling the underlying operation. */
  timeoutSecs: number;
  /** `maxRetries` ≤5; `backoffSecs` 0–86,400, applied exponentially per attempt. */
  retries: { maxRetries: number; backoffSecs: number };
  onSuccess: SuccessBranch;
  onFailure: FailureBranch;
}

/** At most 65,536 serialized bytes. */
export interface WorkflowDefinition {
  trigger: WorkflowTrigger;
  missedPolicy: MissedPolicy;
  steps: WorkflowStep[];
}

// ---------------------------------------------------------------- observations

export interface WorkflowSummary {
  id: string;
  /** Nonblank, control-free, ≤128 bytes. */
  name: string;
  enabled: boolean;
  executionPrincipalId: string;
  createdAtMs: number;
  updatedAtMs: number;
  /** 1 through 2^53−1; every mutation names the revision it expects. */
  revision: number;
}

export interface WorkflowDetail extends WorkflowSummary {
  definition: WorkflowDefinition;
}

/** Engine event names, which differ slightly from trigger kinds (`agent_started`). */
export type AutomationEventKind =
  | 'agent_started' | 'server_started' | 'server_stopped' | 'server_crashed' | 'player_count_zero'
  | 'first_player_joined' | 'update_available' | 'backup_completed' | 'backup_failed';

/** What admitted a run. Native passes unknown shapes through as `{ kind: 'other' }`. */
export type RunTrigger =
  | { kind: 'manual' }
  /** Scheduled occurrence (cron or interval), epoch ms. */
  | { kind: 'schedule'; occurrenceMs: number }
  | { kind: 'event'; event: { kind: AutomationEventKind; profile?: string | null } }
  | { kind: 'other' };

/**
 * `queued`: admitted behind another run of the same workflow. `suspended`: authorization was
 * explicitly refused; only discard ends it. Finished runs are `succeeded` or `failed`.
 */
export type RunState = 'queued' | 'running' | 'suspended' | 'succeeded' | 'failed';

export interface RunSummary {
  id: string;
  workflowId: string;
  workflowRevision: number;
  executionPrincipalId: string;
  trigger: RunTrigger;
  state: RunState | (string & {});
  currentStep: number;
  attempt: number;
  nextWakeAtMs: number | null;
  startedAtMs: number;
  finishedAtMs: number | null;
  /** Fixed safe code, e.g. `completed`, `timed_out`, `discarded`, `authority_revoked`, `workflow_deleted`. */
  outcomeCode: string | null;
}

/** The run's pinned definition, as it was when the run was admitted. */
export interface RunDetail extends RunSummary {
  definition: WorkflowDefinition;
}

export type RunStepState = 'waiting' | 'submitting' | 'submitted' | 'succeeded' | 'failed' | 'timed_out';

export interface RunStep {
  runId: string;
  index: number;
  attempt: number;
  /** `index * 6 + attempt`, as a string. */
  cursor: string;
  state: RunStepState | (string & {});
  operationReference: string | null;
  /** Bounded JSON (16 KiB, depth 8). */
  output: unknown;
  errorCode: string | null;
  startedAtMs: number;
  finishedAtMs: number | null;
}

export interface WorkflowDraft {
  name: string;
  executionPrincipalId: string;
  definition: WorkflowDefinition;
}

export interface WorkflowMutation { workflowId: string; revision: number }

export interface ManualRunResult {
  workflowId: string;
  /** Null when the run was skipped (another run of this workflow is active). */
  runId: string | null;
  skipped: boolean;
}

export interface Paged<T> { items: T[]; nextAfter: string | null }

// ------------------------------------------------------------------ commands

export const serversAutomationNative = {
  /** GET session → the caller's own principal and highest current role rank (an informational hint). */
  automationSelf: (connectionId: ConnectionId) => call<{ principalId: string; rank: number }>('server_automation_self', { connectionId }),
  /** GET automation/workflows?after&limit=100 — ascending by id; `nextAfter` when the page was full. */
  automationWorkflows: (connectionId: ConnectionId, after: string | null) =>
    call<Paged<WorkflowSummary>>('server_automation_workflows', { connectionId, after }),
  /** GET automation/workflows/{id}. */
  automationWorkflow: (connectionId: ConnectionId, workflowId: string) =>
    call<WorkflowDetail>('server_automation_workflow', { connectionId, workflowId }),
  /** POST automation/workflows `{name,execution_principal_id,definition,enabled}` (201). */
  automationWorkflowCreate: (connectionId: ConnectionId, draft: WorkflowDraft, enabled: boolean, intentId: string) =>
    call<WorkflowMutation>('server_automation_workflow_create', { connectionId, draft, enabled, intentId }),
  /** PUT automation/workflows/{id} `{expected_revision,name,execution_principal_id,definition}`. */
  automationWorkflowUpdate: (connectionId: ConnectionId, workflowId: string, expectedRevision: number, draft: WorkflowDraft, intentId: string) =>
    call<WorkflowMutation>('server_automation_workflow_update', { connectionId, workflowId, expectedRevision, draft, intentId }),
  /** DELETE automation/workflows/{id} `{expected_revision}`. Pinned run history is kept. */
  automationWorkflowDelete: (connectionId: ConnectionId, workflowId: string, expectedRevision: number, intentId: string) =>
    call<void>('server_automation_workflow_delete', { connectionId, workflowId, expectedRevision, intentId }),
  /** POST automation/workflows/{id}/enabled `{expected_revision,enabled}`. */
  automationWorkflowSetEnabled: (connectionId: ConnectionId, workflowId: string, expectedRevision: number, enabled: boolean, intentId: string) =>
    call<WorkflowMutation>('server_automation_workflow_enabled', { connectionId, workflowId, expectedRevision, enabled, intentId }),
  /** POST automation/workflows/{id}/run `{}` — only an enabled workflow with the manual trigger (else `conflict`). */
  automationWorkflowRun: (connectionId: ConnectionId, workflowId: string, intentId: string) =>
    call<ManualRunResult>('server_automation_workflow_run', { connectionId, workflowId, intentId }),
  /** GET automation/workflows/{id}/runs?after&limit=100 — ascending by run id. */
  automationWorkflowRuns: (connectionId: ConnectionId, workflowId: string, after: string | null) =>
    call<Paged<RunSummary>>('server_automation_workflow_runs', { connectionId, workflowId, after }),
  /** GET automation/runs?after&limit=100 — every workflow's runs, including deleted workflows'. */
  automationRuns: (connectionId: ConnectionId, after: string | null) =>
    call<Paged<RunSummary>>('server_automation_runs', { connectionId, after }),
  /** GET automation/runs/{id} — with the pinned definition. */
  automationRun: (connectionId: ConnectionId, runId: string) =>
    call<RunDetail>('server_automation_run', { connectionId, runId }),
  /** GET automation/runs/{id}/steps?after&limit=100 — step attempts; cursor `index*6+attempt`. */
  automationRunSteps: (connectionId: ConnectionId, runId: string, after: string | null) =>
    call<Paged<RunStep>>('server_automation_run_steps', { connectionId, runId, after }),
  /** POST automation/runs/{id}/discard `{}` — suspended runs only; never cancels an underlying operation. */
  automationRunDiscard: (connectionId: ConnectionId, runId: string, intentId: string) =>
    call<void>('server_automation_run_discard', { connectionId, runId, intentId }),
};
