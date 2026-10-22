// Pure model for server automation: cron parsing that mirrors the agent's numeric
// five-field parser, a daily/weekly schedule builder, trigger and step sentences, and
// definition validation with the agent's bounds (management API contract §4A).
import type { MessageId } from '../../localization/messages';
import { consoleLineProblem } from './model';
import type {
  ActionKind, FailureBranch, MissedPolicy, RunDetail, RunStep, RunSummary, RunTrigger, SuccessBranch, TriggerKind,
  WorkflowAction, WorkflowDraft, WorkflowStep, WorkflowTrigger,
} from './native-automation';

export type Args = Record<string, string | number>;
export interface Sentence { message: MessageId; args: Args }

export const BOUNDS = {
  steps: [1, 32],
  name: 128,
  stepId: 128,
  timeout: [1, 86_400],
  delay: [1, 86_400],
  retries: [0, 5],
  backoff: [0, 86_400],
  interval: [60, 31_536_000],
  offset: [-840, 840],
  catchUp: [1, 10],
  title: 256,
  body: 4096,
  profile: 128,
  preset: 128,
  params: 32,
  paramKey: 64,
  paramValue: 2048,
  branchKey: 128,
  definitionBytes: 65_536,
} as const;

const encoder = new TextEncoder();
export const utf8Length = (value: string) => encoder.encode(value).length;
/** Rust `char::is_control`: the Cc category. */
const hasControl = (value: string) => /\p{Cc}/u.test(value);

// ------------------------------------------------------------------- cron

export interface CronFields {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  /** 0–6, Sunday is 0 (7 is folded into 0). */
  weekdays: number[];
  /** Restricted day-of-month and day-of-week match with OR; a `*`-led field means AND. */
  dayWildcard: boolean;
  weekdayWildcard: boolean;
}

export const CRON_FIELDS = ['minute', 'hour', 'day', 'month', 'weekday'] as const;
const CRON_RANGES: readonly (readonly [number, number])[] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

const cronNumber = (value: string): number | null => (/^\d+$/.test(value) && Number(value) <= 255 ? Number(value) : null);

function cronField(value: string, min: number, max: number, sunday: boolean): number[] | null {
  const values = new Set<number>();
  for (const item of value.split(',')) {
    const pieces = item.split('/');
    if (pieces.length > 2) return null;
    const [range, stepText] = pieces as [string, string | undefined];
    const step = stepText === undefined ? 1 : cronNumber(stepText);
    if (step === null || step === 0) return null;
    let start: number | null;
    let end: number | null;
    if (range === '*') { start = min; end = max; }
    else if (range.includes('-')) {
      const at = range.indexOf('-');
      start = cronNumber(range.slice(0, at));
      end = cronNumber(range.slice(at + 1));
    } else {
      start = cronNumber(range);
      end = item.includes('/') ? max : start;
    }
    if (start === null || end === null || start < min || end > max || start > end) return null;
    for (let n = start; n <= end; n += step) values.add(sunday && n === 7 ? 0 : n);
  }
  return values.size ? [...values].sort((a, b) => a - b) : null;
}

/** Numeric five-field cron with lists, inclusive ranges and positive steps; Sunday is 0 or 7. */
export function parseCron(expr: string): CronFields | null {
  return cronCheck(expr).fields;
}

function cronCheck(expr: string): { fields: CronFields | null; field: number | null } {
  if (utf8Length(expr) > 256 || hasControl(expr)) return { fields: null, field: null };
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return { fields: null, field: null };
  const parsed: number[][] = [];
  for (let index = 0; index < 5; index++) {
    const [min, max] = CRON_RANGES[index]!;
    const values = cronField(parts[index]!, min, max, index === 4);
    if (!values) return { fields: null, field: index };
    parsed.push(values);
  }
  return {
    fields: {
      minutes: parsed[0]!, hours: parsed[1]!, days: parsed[2]!, months: parsed[3]!, weekdays: parsed[4]!,
      dayWildcard: parts[2]!.startsWith('*'), weekdayWildcard: parts[4]!.startsWith('*'),
    },
    field: null,
  };
}

const cronFieldMessages: Record<(typeof CRON_FIELDS)[number], MessageId> = {
  minute: 'server-automation.problem-cron-minute',
  hour: 'server-automation.problem-cron-hour',
  day: 'server-automation.problem-cron-day',
  month: 'server-automation.problem-cron-month',
  weekday: 'server-automation.problem-cron-weekday',
};

export function cronProblem(expr: string): MessageId | null {
  const { fields, field } = cronCheck(expr);
  if (fields) return null;
  return field === null ? 'server-automation.problem-cron-fields' : cronFieldMessages[CRON_FIELDS[field]];
}

/** The friendly builder: a time of day, every day or on chosen weekdays. */
export type CronSchedule =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekdays: number[]; hour: number; minute: number };

const plain = (value: string, min: number, max: number) => (/^\d+$/.test(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null);

/** Recognizes `M H * * *` and `M H * * <weekdays>`; anything else is a custom expression. */
export function scheduleFromCron(expr: string): CronSchedule | null {
  const fields = parseCron(expr);
  if (!fields) return null;
  const parts = expr.trim().split(/\s+/);
  const minute = plain(parts[0]!, 0, 59);
  const hour = plain(parts[1]!, 0, 23);
  if (minute === null || hour === null || parts[2] !== '*' || parts[3] !== '*') return null;
  if (parts[4] === '*' || fields.weekdays.length === 7) return { kind: 'daily', hour, minute };
  if (parts[4]!.includes('/')) return null;
  return { kind: 'weekly', weekdays: fields.weekdays, hour, minute };
}

/** Weekdays as a compact list, folding runs of three or more into ranges (`1-5`). */
function weekdayList(days: readonly number[]) {
  const sorted = [...new Set(days.map((day) => (day === 7 ? 0 : day)))].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length;) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) end++;
    if (end - index >= 2) parts.push(`${sorted[index]}-${sorted[end]}`);
    else for (let n = index; n <= end; n++) parts.push(String(sorted[n]));
    index = end + 1;
  }
  return parts.join(',');
}

export function cronFromSchedule(schedule: CronSchedule): string {
  const head = `${schedule.minute} ${schedule.hour} * *`;
  if (schedule.kind === 'daily' || schedule.weekdays.length === 0 || new Set(schedule.weekdays.map((day) => day % 7)).size === 7) return `${head} *`;
  return `${head} ${weekdayList(schedule.weekdays)}`;
}

// ------------------------------------------------------------- sentences

const pad = (value: number) => String(value).padStart(2, '0');
export const clockTime = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;

/** `UTC`, `UTC+10:00`, `UTC-03:30`. */
export function formatOffset(minutes: number) {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '-';
  const value = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** The user's current fixed offset; the agent never applies time zones or DST itself. */
export const localOffsetMinutes = (date = new Date()) => clamp(-date.getTimezoneOffset() || 0, BOUNDS.offset[0], BOUNDS.offset[1]);

/** Every quarter hour across the agent's range, plus `current` when it is off the grid. */
export function offsetChoices(current?: number) {
  const values: number[] = [];
  for (let value = BOUNDS.offset[0]; value <= BOUNDS.offset[1]; value += 15) values.push(value);
  if (current !== undefined && !values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b);
}

const ENGLISH_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const eventSentences: Record<Exclude<TriggerKind, 'cron' | 'interval' | 'backup_completed' | 'backup_failed'>, MessageId> = {
  manual: 'server-automation.sentence-manual',
  agent_startup: 'server-automation.sentence-agent-startup',
  server_started: 'server-automation.sentence-server-started',
  server_stopped: 'server-automation.sentence-server-stopped',
  server_crashed: 'server-automation.sentence-server-crashed',
  player_count_zero: 'server-automation.sentence-player-count-zero',
  first_player_joined: 'server-automation.sentence-first-player-joined',
  update_available: 'server-automation.sentence-update-available',
};

/** A duration as its largest whole unit: 7200 → 2 hours, 90 → 90 seconds. */
export function duration(seconds: number): { message: MessageId; count: number } {
  if (seconds > 0 && seconds % 86_400 === 0) return { message: 'server-automation.duration-days', count: seconds / 86_400 };
  if (seconds > 0 && seconds % 3600 === 0) return { message: 'server-automation.duration-hours', count: seconds / 3600 };
  if (seconds > 0 && seconds % 60 === 0) return { message: 'server-automation.duration-minutes', count: seconds / 60 };
  return { message: 'server-automation.duration-seconds', count: seconds };
}

/** A human sentence for a trigger, e.g. "Every day at 04:00 (UTC+10:00)". */
export function triggerSentence(trigger: WorkflowTrigger, weekdayName: (day: number) => string = (day) => ENGLISH_WEEKDAYS[day]!): Sentence {
  switch (trigger.kind) {
    case 'cron': {
      const offset = formatOffset(trigger.utcOffsetMinutes);
      const schedule = scheduleFromCron(trigger.expr);
      if (schedule?.kind === 'daily') return { message: 'server-automation.sentence-daily', args: { time: clockTime(schedule.hour, schedule.minute), value: offset } };
      if (schedule?.kind === 'weekly') {
        const time = clockTime(schedule.hour, schedule.minute);
        if (schedule.weekdays.join() === '1,2,3,4,5') return { message: 'server-automation.sentence-weekdays', args: { time, value: offset } };
        return { message: 'server-automation.sentence-weekly', args: { name: schedule.weekdays.map(weekdayName).join(', '), time, value: offset } };
      }
      return { message: 'server-automation.sentence-cron', args: { name: trigger.expr.trim(), value: offset } };
    }
    case 'interval': {
      const unit = duration(trigger.seconds);
      const message: Record<string, MessageId> = {
        'server-automation.duration-days': 'server-automation.sentence-every-days',
        'server-automation.duration-hours': 'server-automation.sentence-every-hours',
        'server-automation.duration-minutes': 'server-automation.sentence-every-minutes',
        'server-automation.duration-seconds': 'server-automation.sentence-every-seconds',
      };
      return { message: message[unit.message]!, args: { count: unit.count } };
    }
    case 'backup_completed':
      return trigger.profile ? { message: 'server-automation.sentence-backup-completed-profile', args: { name: trigger.profile } } : { message: 'server-automation.sentence-backup-completed', args: {} };
    case 'backup_failed':
      return trigger.profile ? { message: 'server-automation.sentence-backup-failed-profile', args: { name: trigger.profile } } : { message: 'server-automation.sentence-backup-failed', args: {} };
    default:
      return { message: eventSentences[trigger.kind], args: {} };
  }
}

const eventTriggers: Record<string, TriggerKind> = {
  agent_started: 'agent_startup', server_started: 'server_started', server_stopped: 'server_stopped', server_crashed: 'server_crashed',
  player_count_zero: 'player_count_zero', first_player_joined: 'first_player_joined', update_available: 'update_available',
  backup_completed: 'backup_completed', backup_failed: 'backup_failed',
};

/** What admitted a run. `formatTime` renders a schedule occurrence. */
export function runTriggerSentence(trigger: RunTrigger, formatTime: (ms: number) => string = (ms) => new Date(ms).toISOString()): Sentence {
  switch (trigger.kind) {
    case 'manual': return { message: 'server-automation.run-trigger-manual', args: {} };
    case 'schedule': return { message: 'server-automation.run-trigger-schedule', args: { time: formatTime(trigger.occurrenceMs) } };
    case 'event': {
      const kind = eventTriggers[trigger.event.kind];
      if (!kind) return { message: 'server-automation.run-trigger-other', args: {} };
      if (kind === 'backup_completed' || kind === 'backup_failed') return triggerSentence({ kind, profile: trigger.event.profile ?? null });
      return triggerSentence({ kind } as WorkflowTrigger);
    }
    default: return { message: 'server-automation.run-trigger-other', args: {} };
  }
}

const simpleSteps: Record<'start' | 'stop' | 'restart' | 'clean_trash', MessageId> = {
  start: 'server-automation.step-start',
  stop: 'server-automation.step-stop',
  restart: 'server-automation.step-restart',
  clean_trash: 'server-automation.step-clean-trash',
};

const shorten = (value: string, max = 60) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** One line describing a step's action. `duration` fills the `time` argument when present. */
export function stepSummary(action: WorkflowAction | DraftAction): Sentence & { duration?: { message: MessageId; count: number } } {
  switch (action.kind) {
    case 'delay': return { message: 'server-automation.step-delay', args: {}, duration: duration(action.secs) };
    case 'backup': return { message: 'server-automation.step-backup', args: { name: action.profile } };
    case 'verify_backup': return { message: 'server-automation.step-verify', args: { name: action.profile } };
    case 'console_command': return { message: 'server-automation.step-console', args: { value: shorten(action.line) } };
    case 'notify': {
      const message: Record<string, MessageId> = {
        info: 'server-automation.step-notify-info', warning: 'server-automation.step-notify-warning', critical: 'server-automation.step-notify-critical',
      };
      return { message: message[action.severity]!, args: { name: shorten(action.title) } };
    }
    case 'script_preset': return { message: 'server-automation.step-script', args: { name: action.preset, count: Array.isArray(action.params) ? action.params.length : Object.keys(action.params).length } };
    default: return { message: simpleSteps[action.kind], args: {} };
  }
}

// ------------------------------------------------------------------ drafts

/** Script parameters are edited as ordered rows so typing never merges keys. */
export type DraftAction =
  | Exclude<WorkflowAction, { kind: 'script_preset' }>
  | { kind: 'script_preset'; preset: string; params: [string, string][] };

export interface DraftStep extends Omit<WorkflowStep, 'action'> { action: DraftAction }

export interface EditorDraft {
  name: string;
  executionPrincipalId: string;
  /** Only sent when creating; existing workflows toggle through their own route. */
  enabled: boolean;
  trigger: WorkflowTrigger;
  missedPolicy: MissedPolicy;
  steps: DraftStep[];
}

const toDraftAction = (action: WorkflowAction): DraftAction =>
  action.kind === 'script_preset' ? { kind: 'script_preset', preset: action.preset, params: Object.entries(action.params) } : structuredClone(action);

export function toEditorDraft(draft: WorkflowDraft, enabled: boolean): EditorDraft {
  return {
    name: draft.name,
    executionPrincipalId: draft.executionPrincipalId,
    enabled,
    trigger: structuredClone(draft.definition.trigger),
    missedPolicy: structuredClone(draft.definition.missedPolicy),
    steps: draft.definition.steps.map((step) => ({ ...structuredClone(step), action: toDraftAction(step.action) })),
  };
}

export function fromEditorDraft(draft: EditorDraft): WorkflowDraft {
  const steps: WorkflowStep[] = draft.steps.map((step) => ({
    ...structuredClone(step),
    id: step.id.trim(),
    action: step.action.kind === 'script_preset'
      ? { kind: 'script_preset', preset: step.action.preset.trim(), params: Object.fromEntries(step.action.params) }
      : structuredClone(step.action),
  }));
  const trigger = draft.trigger.kind === 'cron' ? { ...draft.trigger, expr: draft.trigger.expr.trim() } : structuredClone(draft.trigger);
  return { name: draft.name.trim(), executionPrincipalId: draft.executionPrincipalId, definition: { trigger, missedPolicy: structuredClone(draft.missedPolicy), steps } };
}

/** Missed-run handling only matters for schedules. */
export const isScheduled = (trigger: WorkflowTrigger) => trigger.kind === 'cron' || trigger.kind === 'interval';

/** Ids of the steps a branch at `index` may jump to: forward only, never a loop. */
export const forwardTargets = (steps: readonly { id: string }[], index: number) => steps.slice(index + 1).map((step) => step.id);

export function uniqueStepId(base: string, steps: readonly { id: string }[]) {
  const taken = new Set(steps.map((step) => step.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const actionIds: Record<ActionKind, string> = {
  delay: 'wait', backup: 'backup', verify_backup: 'verify', start: 'start', stop: 'stop', restart: 'restart',
  clean_trash: 'clean-trash', console_command: 'command', notify: 'notify', script_preset: 'script',
};

export function defaultAction(kind: ActionKind, profile = 'daily'): DraftAction {
  switch (kind) {
    case 'delay': return { kind, secs: 60 };
    case 'backup': case 'verify_backup': return { kind, profile };
    case 'console_command': return { kind, line: '' };
    case 'notify': return { kind, severity: 'info', title: '', body: '' };
    case 'script_preset': return { kind, preset: '', params: [] };
    default: return { kind };
  }
}

/** A sensible deadline per action; a delay's deadline must outlast the delay. */
export function defaultTimeout(action: DraftAction) {
  switch (action.kind) {
    case 'delay': return Math.min(BOUNDS.timeout[1], action.secs + 60);
    case 'backup': case 'verify_backup': return 3600;
    case 'start': case 'stop': case 'restart': return 600;
    default: return 120;
  }
}

export function newStep(kind: ActionKind, steps: readonly { id: string }[], profile?: string): DraftStep {
  const action = defaultAction(kind, profile);
  return { id: uniqueStepId(actionIds[kind], steps), action, timeoutSecs: defaultTimeout(action), retries: { maxRetries: 0, backoffSecs: 0 }, onSuccess: { kind: 'next' }, onFailure: { kind: 'fail' } };
}

/** Renames a step and every branch that points at it. */
export function renameStep(steps: DraftStep[], index: number, id: string): DraftStep[] {
  const previous = steps[index]?.id;
  return steps.map((step, at) => {
    const next = at === index ? { ...step, id } : step;
    if (previous === undefined || at === index) return next;
    return { ...next, onSuccess: retarget(next.onSuccess, previous, id) as SuccessBranch, onFailure: retarget(next.onFailure, previous, id) as FailureBranch };
  });
}

function retarget(branch: SuccessBranch | FailureBranch, from: string, to: string): SuccessBranch | FailureBranch {
  if (branch.kind === 'goto') return branch.stepId === from ? { ...branch, stepId: to } : branch;
  if (branch.kind === 'if_output_equals') return { ...branch, thenStep: branch.thenStep === from ? to : branch.thenStep, otherwise: branch.otherwise === from ? to : branch.otherwise };
  return branch;
}

/** Removes a step; branches that pointed at it fall back to their defaults. */
export function removeStep(steps: DraftStep[], index: number): DraftStep[] {
  const removed = steps[index]?.id;
  return steps.filter((_, at) => at !== index).map((step) => ({
    ...step,
    onSuccess: (step.onSuccess.kind === 'goto' && step.onSuccess.stepId === removed) || (step.onSuccess.kind === 'if_output_equals' && step.onSuccess.thenStep === removed) ? { kind: 'next' } : step.onSuccess,
    onFailure: step.onFailure.kind === 'goto' && step.onFailure.stepId === removed ? { kind: 'fail' } : step.onFailure,
  }));
}

export function moveStep<T>(steps: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

// -------------------------------------------------------------- validation

export interface Problem { path: string; message: MessageId; args?: Args }

function text(path: string, value: string, max: number, allowEmpty = false): Problem | null {
  if (!allowEmpty && !value.trim()) return { path, message: 'server-automation.problem-required' };
  if (hasControl(value)) return { path, message: 'server-automation.problem-control' };
  if (utf8Length(value) > max) return { path, message: 'server-automation.problem-too-long', args: { max } };
  return null;
}

function range(path: string, value: number, [min, max]: readonly [number, number]): Problem | null {
  return Number.isInteger(value) && value >= min && value <= max ? null : { path, message: 'server-automation.problem-range', args: { min, max } };
}

/** The agent's definition shape in snake_case, for the serialized-size bound. */
function wireSize(draft: WorkflowDraft) {
  const snake = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(snake);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), key === 'params' ? entry : snake(entry)]));
    return value;
  };
  return utf8Length(JSON.stringify(snake(draft.definition)));
}

/** Every problem the agent would reject, keyed by a field path the editor shows inline. */
export function workflowProblems(draft: EditorDraft): Problem[] {
  const problems: (Problem | null)[] = [];
  problems.push(text('name', draft.name, BOUNDS.name));
  if (!draft.executionPrincipalId.trim()) problems.push({ path: 'principal', message: 'server-automation.problem-required' });

  const trigger = draft.trigger;
  if (trigger.kind === 'cron') {
    const cron = cronProblem(trigger.expr);
    if (cron) problems.push({ path: 'trigger.expr', message: cron });
    problems.push(range('trigger.offset', trigger.utcOffsetMinutes, BOUNDS.offset));
  } else if (trigger.kind === 'interval') {
    problems.push(range('trigger.seconds', trigger.seconds, BOUNDS.interval));
  } else if ((trigger.kind === 'backup_completed' || trigger.kind === 'backup_failed') && trigger.profile !== null) {
    problems.push(text('trigger.profile', trigger.profile, BOUNDS.profile));
  }
  if (draft.missedPolicy.kind === 'catch_up') problems.push(range('missed.max', draft.missedPolicy.max, BOUNDS.catchUp));

  if (draft.steps.length < BOUNDS.steps[0] || draft.steps.length > BOUNDS.steps[1]) {
    problems.push({ path: 'steps', message: 'server-automation.problem-step-count', args: { min: BOUNDS.steps[0], max: BOUNDS.steps[1] } });
  }
  const seen = new Set<string>();
  draft.steps.forEach((step, index) => {
    const at = `steps.${index}`;
    const id = text(`${at}.id`, step.id, BOUNDS.stepId);
    if (id) problems.push(id);
    else if (seen.has(step.id)) problems.push({ path: `${at}.id`, message: 'server-automation.problem-duplicate-id' });
    seen.add(step.id);
    problems.push(range(`${at}.timeout`, step.timeoutSecs, BOUNDS.timeout));
    problems.push(range(`${at}.retries`, step.retries.maxRetries, BOUNDS.retries));
    problems.push(range(`${at}.backoff`, step.retries.backoffSecs, BOUNDS.backoff));
    problems.push(...actionProblems(`${at}.action`, step.action));
    // A delay observed at or after its deadline fails, so the deadline must outlast it.
    if (step.action.kind === 'delay' && Number.isInteger(step.action.secs) && step.timeoutSecs <= step.action.secs) {
      problems.push({ path: `${at}.timeout`, message: 'server-automation.problem-delay-timeout' });
    }
    const forward = new Set(forwardTargets(draft.steps, index));
    const success = step.onSuccess;
    if (success.kind === 'goto' && !forward.has(success.stepId)) problems.push({ path: `${at}.onSuccess`, message: 'server-automation.problem-forward' });
    if (success.kind === 'if_output_equals') {
      if (!forward.has(success.thenStep) || (success.otherwise !== null && !forward.has(success.otherwise))) problems.push({ path: `${at}.onSuccess`, message: 'server-automation.problem-forward' });
      problems.push(text(`${at}.onSuccess`, success.key, BOUNDS.branchKey));
    }
    if (step.onFailure.kind === 'goto' && !forward.has(step.onFailure.stepId)) problems.push({ path: `${at}.onFailure`, message: 'server-automation.problem-forward' });
  });
  const found = problems.filter((problem): problem is Problem => problem !== null);
  if (!found.length && wireSize(fromEditorDraft(draft)) > BOUNDS.definitionBytes) found.push({ path: 'definition', message: 'server-automation.problem-too-large' });
  return found;
}

function actionProblems(at: string, action: DraftAction): (Problem | null)[] {
  switch (action.kind) {
    case 'delay': return [range(`${at}.secs`, action.secs, BOUNDS.delay)];
    case 'backup': case 'verify_backup': return [text(`${at}.profile`, action.profile, BOUNDS.profile)];
    case 'console_command': {
      const problem = consoleLineProblem(action.line);
      return [problem ? { path: `${at}.line`, message: problem } : null];
    }
    case 'notify': return [text(`${at}.title`, action.title, BOUNDS.title), text(`${at}.body`, action.body, BOUNDS.body, true)];
    case 'script_preset': {
      const problems: (Problem | null)[] = [text(`${at}.preset`, action.preset, BOUNDS.preset)];
      if (action.params.length > BOUNDS.params) problems.push({ path: `${at}.params`, message: 'server-automation.problem-param-count', args: { max: BOUNDS.params } });
      const keys = new Set<string>();
      action.params.forEach(([key, value], index) => {
        const keyProblem = text(`${at}.params.${index}.key`, key, BOUNDS.paramKey);
        if (keyProblem) problems.push(keyProblem);
        else if (keys.has(key)) problems.push({ path: `${at}.params.${index}.key`, message: 'server-automation.problem-duplicate-key' });
        keys.add(key);
        problems.push(text(`${at}.params.${index}.value`, value, BOUNDS.paramValue, true));
      });
      return problems;
    }
    default: return [];
  }
}

/** Validates a wire draft (used by fixtures and before submitting). */
export const draftProblems = (draft: WorkflowDraft) => workflowProblems(toEditorDraft(draft, false));

// ---------------------------------------------------------------- templates

export type TemplateId = 'nightly-backup' | 'restart-every' | 'announce-join' | 'blank';
export const TEMPLATES: TemplateId[] = ['nightly-backup', 'restart-every', 'announce-join', 'blank'];

const step = (id: string, action: DraftAction, extra: Partial<DraftStep> = {}): DraftStep => ({
  id, action, timeoutSecs: defaultTimeout(action), retries: { maxRetries: 0, backoffSecs: 0 }, onSuccess: { kind: 'next' }, onFailure: { kind: 'fail' }, ...extra,
});

/** A starting point for a new workflow. Step text is user content and stays editable. */
export function templateDraft(id: TemplateId, options: { name: string; principalId: string; offsetMinutes: number; profile?: string }): EditorDraft {
  const base = { name: options.name, executionPrincipalId: options.principalId, enabled: true, missedPolicy: { kind: 'skip_and_notify' } as MissedPolicy };
  const profile = options.profile ?? 'daily';
  switch (id) {
    case 'nightly-backup':
      return {
        ...base,
        trigger: { kind: 'cron', expr: '0 4 * * *', utcOffsetMinutes: options.offsetMinutes },
        steps: [
          step('warn-players', { kind: 'console_command', line: 'say The server restarts in 1 minute for the nightly backup.' }),
          step('wait', { kind: 'delay', secs: 60 }),
          step('backup', { kind: 'backup', profile }, { retries: { maxRetries: 1, backoffSecs: 300 }, onFailure: { kind: 'goto', stepId: 'alert' } }),
          step('restart', { kind: 'restart' }, { onSuccess: { kind: 'end' } }),
          step('alert', { kind: 'notify', severity: 'critical', title: 'Nightly backup failed', body: "The nightly backup didn't finish, so the server wasn't restarted." }),
        ],
      };
    case 'restart-every':
      return {
        ...base,
        trigger: { kind: 'interval', seconds: 6 * 3600 },
        steps: [
          step('warn-players', { kind: 'console_command', line: 'say Restarting in 1 minute.' }),
          step('wait', { kind: 'delay', secs: 60 }),
          step('restart', { kind: 'restart' }),
        ],
      };
    case 'announce-join':
      return {
        ...base,
        trigger: { kind: 'first_player_joined' },
        steps: [step('welcome', { kind: 'console_command', line: 'say Welcome back! Backups run nightly at 04:00.' })],
      };
    case 'blank':
      return { ...base, enabled: false, trigger: { kind: 'manual' }, steps: [step('notify', { kind: 'notify', severity: 'info', title: 'Workflow ran', body: '' })] };
  }
}

// --------------------------------------------------------------------- runs

export const isActiveRun = (run: RunSummary) => run.state === 'running' || run.state === 'suspended' || run.state === 'queued';
export const runsNewestFirst = (runs: readonly RunSummary[]) => [...runs].sort((a, b) => b.startedAtMs - a.startedAtMs || (a.id < b.id ? 1 : -1));

export function lastRunByWorkflow(runs: readonly RunSummary[]) {
  const last = new Map<string, RunSummary>();
  for (const run of runs) {
    const known = last.get(run.workflowId);
    if (!known || run.startedAtMs > known.startedAtMs) last.set(run.workflowId, run);
  }
  return last;
}

export interface StepRow {
  index: number;
  step: WorkflowStep | null;
  attempts: RunStep[];
  latest: RunStep | null;
  /** An attempt state, or `skipped` (finished without reaching it) / `pending` (not reached yet). */
  state: string;
}

/** Joins the pinned definition with recorded attempts, so unreached steps still show. */
export function stepRows(run: RunDetail, attempts: readonly RunStep[]): StepRow[] {
  const finished = run.finishedAtMs !== null;
  const count = Math.max(run.definition.steps.length, ...attempts.map((attempt) => attempt.index + 1));
  return Array.from({ length: count }, (_, index) => {
    const own = attempts.filter((attempt) => attempt.index === index).sort((a, b) => a.attempt - b.attempt);
    const latest = own.at(-1) ?? null;
    return { index, step: run.definition.steps[index] ?? null, attempts: own, latest, state: latest?.state ?? (finished || run.state === 'suspended' ? 'skipped' : 'pending') };
  });
}

/** A short, single-line JSON preview of a step's output. */
export function outputPreview(output: unknown, max = 160): string | null {
  if (output === null || output === undefined) return null;
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface OutputField { label: string; value: string | boolean }

/** Flat step output as readable label/value pairs; null when there is nothing worth showing.
 * Nested values keep a compact JSON preview so nothing the agent reported is hidden. */
export function outputFields(output: unknown, max = 6): OutputField[] | null {
  if (output === null || output === undefined) return null;
  if (typeof output !== 'object' || Array.isArray(output)) {
    const preview = outputPreview(output);
    return preview ? [{ label: '', value: preview }] : null;
  }
  const entries = Object.entries(output as Record<string, unknown>).filter(([, value]) => value !== null && value !== undefined);
  if (!entries.length) return null;
  return entries.slice(0, max).map(([key, value]) => ({
    label: key.replace(/[_-]+/g, ' ').replace(/^./, (first) => first.toUpperCase()),
    value: typeof value === 'boolean' ? value : typeof value === 'string' || typeof value === 'number' ? String(value) : outputPreview(value, 60) ?? '',
  }));
}
