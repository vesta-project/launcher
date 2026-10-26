import { describe, expect, test } from 'bun:test';
import {
  cronFromSchedule, cronProblem, draftProblems, formatOffset, fromEditorDraft, moveStep, newStep, parseCron, removeStep, renameStep,
  runTriggerSentence, scheduleFromCron, stepRows, stepSummary, templateDraft, toEditorDraft, triggerSentence, workflowProblems,
} from '../src/features/servers/automation-model';
import { createFixtureServers } from '../src/features/servers/fixtures';
import { createAutomationFixtures } from '../src/features/servers/fixtures-automation';

const draft = (overrides = {}) => ({ ...templateDraft('nightly-backup', { name: 'Nightly', principalId: 'p-self', offsetMinutes: 600 }), ...overrides });
const paths = (problems) => problems.map((problem) => problem.path);
const wire = (overrides = {}) => fromEditorDraft(draft(overrides));
test('new-player template uses a distinct first-visit trigger with named history', () => {
  const template = templateDraft('announce-join', { name: 'Welcome', principalId: 'p-self', offsetMinutes: 0 });
  expect(template.trigger.kind).toBe('player_first_joined');
  expect(workflowProblems(template)).toEqual([]);
  expect(triggerSentence({ kind: 'player_first_joined' }).message).toBe('server-automation.sentence-player-first-joined');
  expect(runTriggerSentence({ kind: 'event', event: { kind: 'player_first_joined', player: 'Alex', uuid: 'a'.repeat(32) } })).toEqual({ message: 'server-automation.run-new-player', args: { name: 'Alex' } });
});

describe('[cron] numeric five-field parsing mirrors the agent', () => {
  test('lists, ranges, steps and wildcards', () => {
    const fields = parseCron('*/15 9-17 1,15 * 1-5');
    expect(fields.minutes).toEqual([0, 15, 30, 45]);
    expect(fields.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(fields.days).toEqual([1, 15]);
    expect(fields.months).toHaveLength(12);
    expect(fields.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(fields.dayWildcard).toBe(false);
    expect(parseCron('0 0 * * *').dayWildcard).toBe(true);
    // A start with a step runs to the end of the field, as in the agent.
    expect(parseCron('5/20 * * * *').minutes).toEqual([5, 25, 45]);
    expect(parseCron('0-30/10 * * * *').minutes).toEqual([0, 10, 20, 30]);
  });
  test('Sunday is both 0 and 7', () => {
    expect(parseCron('0 0 * * 7').weekdays).toEqual([0]);
    expect(parseCron('0 0 * * 0,7').weekdays).toEqual([0]);
    expect(parseCron('0 0 * * 5-7').weekdays).toEqual([0, 5, 6]);
  });
  test('rejects what the agent rejects, naming the field', () => {
    expect(cronProblem('0 4 * *')).toBe('server-automation.problem-cron-fields');
    expect(cronProblem('0 4 * * * *')).toBe('server-automation.problem-cron-fields');
    expect(cronProblem('')).toBe('server-automation.problem-cron-fields');
    expect(cronProblem('60 4 * * *')).toBe('server-automation.problem-cron-minute');
    expect(cronProblem('0 24 * * *')).toBe('server-automation.problem-cron-hour');
    expect(cronProblem('0 4 0 * *')).toBe('server-automation.problem-cron-day');
    expect(cronProblem('0 4 * 13 *')).toBe('server-automation.problem-cron-month');
    expect(cronProblem('0 4 * * 8')).toBe('server-automation.problem-cron-weekday');
    expect(cronProblem('0 4 * JAN *')).toBe('server-automation.problem-cron-month');
    expect(cronProblem('*/0 * * * *')).toBe('server-automation.problem-cron-minute');
    expect(cronProblem('5-1 * * * *')).toBe('server-automation.problem-cron-minute');
    expect(cronProblem('1,,2 * * * *')).toBe('server-automation.problem-cron-minute');
    expect(cronProblem('1/2/3 * * * *')).toBe('server-automation.problem-cron-minute');
    expect(cronProblem('-1 * * * *')).toBe('server-automation.problem-cron-minute');
    expect(cronProblem('0 4 * * *\u0007')).toBe('server-automation.problem-cron-fields');
    expect(cronProblem('  0   4 * * *  ')).toBeNull();
  });
});

describe('[cron] the daily/weekly builder round-trips', () => {
  test('daily and weekly schedules become cron and back', () => {
    for (const schedule of [
      { kind: 'daily', hour: 4, minute: 0 },
      { kind: 'daily', hour: 23, minute: 59 },
      { kind: 'weekly', hour: 6, minute: 30, weekdays: [1, 3, 5] },
      { kind: 'weekly', hour: 0, minute: 5, weekdays: [0, 6] },
      { kind: 'weekly', hour: 12, minute: 0, weekdays: [1, 2, 3, 4, 5] },
    ]) {
      expect(scheduleFromCron(cronFromSchedule(schedule))).toEqual(schedule);
    }
    expect(cronFromSchedule({ kind: 'weekly', hour: 9, minute: 0, weekdays: [5, 1, 2, 3, 4] })).toBe('0 9 * * 1-5');
    expect(cronFromSchedule({ kind: 'weekly', hour: 9, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe('0 9 * * *');
  });
  test('anything else stays custom', () => {
    expect(scheduleFromCron('*/15 * * * *')).toBeNull();
    expect(scheduleFromCron('0 4 1 * *')).toBeNull();
    expect(scheduleFromCron('0 */2 * * *')).toBeNull();
    expect(scheduleFromCron('0 4 * * */2')).toBeNull();
    expect(scheduleFromCron('0 4 * * 0-6')).toEqual({ kind: 'daily', hour: 4, minute: 0 });
    expect(scheduleFromCron('nope')).toBeNull();
  });
});

describe('[sentences] triggers and steps read as people say them', () => {
  test('schedules', () => {
    expect(triggerSentence({ kind: 'cron', expr: '0 4 * * *', utcOffsetMinutes: 600 })).toEqual({ message: 'server-automation.sentence-daily', args: { time: '04:00', value: 'UTC+10:00' } });
    expect(triggerSentence({ kind: 'cron', expr: '30 18 * * 1-5', utcOffsetMinutes: 0 })).toEqual({ message: 'server-automation.sentence-weekdays', args: { time: '18:30', value: 'UTC' } });
    expect(triggerSentence({ kind: 'cron', expr: '0 9 * * 6,0', utcOffsetMinutes: -210 })).toEqual({ message: 'server-automation.sentence-weekly', args: { name: 'Sun, Sat', time: '09:00', value: 'UTC-03:30' } });
    expect(triggerSentence({ kind: 'cron', expr: '*/5 * * * *', utcOffsetMinutes: 60 })).toEqual({ message: 'server-automation.sentence-cron', args: { name: '*/5 * * * *', value: 'UTC+01:00' } });
    expect(triggerSentence({ kind: 'interval', seconds: 7200 })).toEqual({ message: 'server-automation.sentence-every-hours', args: { count: 2 } });
    expect(triggerSentence({ kind: 'interval', seconds: 5400 })).toEqual({ message: 'server-automation.sentence-every-minutes', args: { count: 90 } });
    expect(triggerSentence({ kind: 'interval', seconds: 172_800 })).toEqual({ message: 'server-automation.sentence-every-days', args: { count: 2 } });
    expect(formatOffset(840)).toBe('UTC+14:00');
    expect(formatOffset(-840)).toBe('UTC-14:00');
  });
  test('events and manual runs', () => {
    expect(triggerSentence({ kind: 'server_crashed' }).message).toBe('server-automation.sentence-server-crashed');
    expect(triggerSentence({ kind: 'manual' }).message).toBe('server-automation.sentence-manual');
    expect(triggerSentence({ kind: 'backup_failed', profile: 'daily' })).toEqual({ message: 'server-automation.sentence-backup-failed-profile', args: { name: 'daily' } });
    expect(triggerSentence({ kind: 'backup_completed', profile: null }).message).toBe('server-automation.sentence-backup-completed');
    expect(runTriggerSentence({ kind: 'event', event: { kind: 'agent_started' } }).message).toBe('server-automation.sentence-agent-startup');
    expect(runTriggerSentence({ kind: 'schedule', occurrenceMs: 0 }, () => 'then')).toEqual({ message: 'server-automation.run-trigger-schedule', args: { time: 'then' } });
    expect(runTriggerSentence({ kind: 'other' }).message).toBe('server-automation.run-trigger-other');
  });
  test('step summaries', () => {
    expect(stepSummary({ kind: 'delay', secs: 120 }).duration).toEqual({ message: 'server-automation.duration-minutes', count: 2 });
    expect(stepSummary({ kind: 'backup', profile: 'daily' })).toEqual({ message: 'server-automation.step-backup', args: { name: 'daily' } });
    expect(stepSummary({ kind: 'notify', severity: 'critical', title: 'Down', body: '' }).message).toBe('server-automation.step-notify-critical');
    expect(stepSummary({ kind: 'script_preset', preset: 'prune', params: { a: '1', b: '2' } }).args).toEqual({ name: 'prune', count: 2 });
    expect(stepSummary({ kind: 'console_command', line: 'x'.repeat(100) }).args.value).toHaveLength(60);
  });
});

describe('[validation] definitions follow the agent bounds', () => {
  test('templates are valid as they come', () => {
    for (const id of ['nightly-backup', 'restart-every', 'announce-join']) {
      expect(workflowProblems(templateDraft(id, { name: 'A', principalId: 'p', offsetMinutes: 0 }))).toEqual([]);
    }
    // The blank template only needs a name.
    expect(paths(workflowProblems(templateDraft('blank', { name: '', principalId: 'p', offsetMinutes: 0 })))).toEqual(['name']);
  });
  test('names, principal, trigger bounds', () => {
    expect(paths(workflowProblems(draft({ name: '  ' })))).toContain('name');
    expect(paths(workflowProblems(draft({ name: 'é'.repeat(65) })))).toContain('name');
    expect(paths(workflowProblems(draft({ name: 'a\nb' })))).toContain('name');
    expect(paths(workflowProblems(draft({ executionPrincipalId: '' })))).toContain('principal');
    expect(paths(workflowProblems(draft({ trigger: { kind: 'cron', expr: '0 4 * *', utcOffsetMinutes: 0 } })))).toContain('trigger.expr');
    expect(paths(workflowProblems(draft({ trigger: { kind: 'cron', expr: '0 4 * * *', utcOffsetMinutes: 841 } })))).toContain('trigger.offset');
    expect(paths(workflowProblems(draft({ trigger: { kind: 'interval', seconds: 59 } })))).toContain('trigger.seconds');
    expect(paths(workflowProblems(draft({ trigger: { kind: 'interval', seconds: 60 } })))).not.toContain('trigger.seconds');
    expect(paths(workflowProblems(draft({ trigger: { kind: 'interval', seconds: 31_536_001 } })))).toContain('trigger.seconds');
    expect(paths(workflowProblems(draft({ missedPolicy: { kind: 'catch_up', max: 11 } })))).toContain('missed.max');
  });
  test('step count, unique ids, delays, timeouts and retries', () => {
    const base = draft();
    expect(paths(workflowProblems({ ...base, steps: [] }))).toContain('steps');
    const many = Array.from({ length: 33 }, (_, index) => ({ ...base.steps[0], id: `s${index}` }));
    expect(paths(workflowProblems({ ...base, steps: many }))).toContain('steps');
    expect(paths(workflowProblems({ ...base, steps: many.slice(0, 32) }))).not.toContain('steps');
    const duplicate = [base.steps[0], { ...base.steps[1], id: base.steps[0].id }];
    expect(workflowProblems({ ...base, steps: duplicate }).find((problem) => problem.path === 'steps.1.id')?.message).toBe('server-automation.problem-duplicate-id');
    const delay = (secs, timeoutSecs) => workflowProblems({ ...base, steps: [{ ...newStep('delay', []), action: { kind: 'delay', secs }, timeoutSecs }] });
    expect(paths(delay(0, 60))).toContain('steps.0.action.secs');
    expect(paths(delay(86_401, 86_400))).toContain('steps.0.action.secs');
    expect(delay(60, 60).find((problem) => problem.path === 'steps.0.timeout')?.message).toBe('server-automation.problem-delay-timeout');
    expect(delay(60, 61)).toEqual([]);
    const step = base.steps[0];
    expect(paths(workflowProblems({ ...base, steps: [{ ...step, timeoutSecs: 0 }] }))).toContain('steps.0.timeout');
    expect(paths(workflowProblems({ ...base, steps: [{ ...step, retries: { maxRetries: 6, backoffSecs: 0 } }] }))).toContain('steps.0.retries');
    expect(paths(workflowProblems({ ...base, steps: [{ ...step, retries: { maxRetries: 1, backoffSecs: 86_401 } }] }))).toContain('steps.0.backoff');
  });
  test('console lines follow the console rules', () => {
    const line = (value) => paths(workflowProblems({ ...draft(), steps: [{ ...newStep('console_command', []), action: { kind: 'console_command', line: value } }] }));
    expect(line('say hi')).toEqual([]);
    expect(line('   ')).toContain('steps.0.action.line');
    expect(line('say\nhi')).toContain('steps.0.action.line');
    expect(line('x'.repeat(1025))).toContain('steps.0.action.line');
    expect(line('é'.repeat(513))).toContain('steps.0.action.line');
  });
  test('notify and script preset bounds', () => {
    const with_ = (action) => paths(workflowProblems({ ...draft(), steps: [{ ...newStep('notify', []), action }] }));
    expect(with_({ kind: 'notify', severity: 'info', title: 'x'.repeat(257), body: '' })).toContain('steps.0.action.title');
    expect(with_({ kind: 'notify', severity: 'info', title: 'ok', body: '' })).toEqual([]);
    expect(with_({ kind: 'script_preset', preset: 'prune', params: [['a', '1'], ['a', '2']] })).toContain('steps.0.action.params.1.key');
    expect(with_({ kind: 'script_preset', preset: '', params: [] })).toContain('steps.0.action.preset');
    expect(with_({ kind: 'script_preset', preset: 'p', params: Array.from({ length: 33 }, (_, index) => [`k${index}`, '']) })).toContain('steps.0.action.params');
  });
  test('branches only jump forward', () => {
    const base = draft();
    const backwards = base.steps.map((step, index) => (index === 3 ? { ...step, onFailure: { kind: 'goto', stepId: 'wait' } } : step));
    expect(paths(workflowProblems({ ...base, steps: backwards }))).toContain('steps.3.onFailure');
    const self = base.steps.map((step, index) => (index === 2 ? { ...step, onSuccess: { kind: 'goto', stepId: 'backup' } } : step));
    expect(paths(workflowProblems({ ...base, steps: self }))).toContain('steps.2.onSuccess');
    const missing = base.steps.map((step, index) => (index === 0 ? { ...step, onSuccess: { kind: 'goto', stepId: 'nowhere' } } : step));
    expect(paths(workflowProblems({ ...base, steps: missing }))).toContain('steps.0.onSuccess');
    // Moving the alert above the backup turns its jump backwards.
    const moved = moveStep(base.steps, 4, -1);
    expect(paths(workflowProblems({ ...base, steps: moveStep(moved, 3, -1) }))).toContain('steps.3.onFailure');
  });
  test('renaming and removing steps keep jumps consistent', () => {
    const base = draft();
    const renamed = renameStep(base.steps, 4, 'tell-owner');
    expect(renamed[2].onFailure).toEqual({ kind: 'goto', stepId: 'tell-owner' });
    expect(workflowProblems({ ...base, steps: renamed })).toEqual([]);
    const removed = removeStep(base.steps, 4);
    expect(removed[2].onFailure).toEqual({ kind: 'fail' });
    expect(workflowProblems({ ...base, steps: removed })).toEqual([]);
    expect(newStep('delay', [{ id: 'wait' }]).id).toBe('wait-2');
  });
  test('editor drafts round-trip to the wire shape', () => {
    const value = wire({ steps: [{ ...newStep('script_preset', []), action: { kind: 'script_preset', preset: 'p', params: [['b', '2'], ['a', '1']] } }] });
    expect(value.definition.steps[0].action.params).toEqual({ b: '2', a: '1' });
    expect(fromEditorDraft(toEditorDraft(value, true))).toEqual(value);
    expect(draftProblems(value)).toEqual([]);
  });
  test('unreached steps of a finished run read as skipped', () => {
    const definition = wire().definition;
    const run = { id: 'r', state: 'succeeded', finishedAtMs: 1, definition };
    const rows = stepRows(run, [
      { index: 0, attempt: 0, state: 'succeeded' }, { index: 2, attempt: 0, state: 'failed' }, { index: 2, attempt: 1, state: 'failed' }, { index: 4, attempt: 0, state: 'succeeded' },
    ]);
    expect(rows.map((row) => row.state)).toEqual(['succeeded', 'skipped', 'failed', 'skipped', 'succeeded']);
    expect(rows[2].attempts).toHaveLength(2);
    expect(stepRows({ ...run, state: 'running', finishedAtMs: null }, [])[0].state).toBe('pending');
  });
});

describe('[fixtures] workflows behave like the agent', () => {
  const servers = () => createFixtureServers({ latencyMs: 0 });
  test('seeded workflows and history', async () => {
    const api = servers();
    const { items } = await api.automationWorkflows('fixture-survival', null);
    expect(items.map((item) => item.name)).toEqual(expect.arrayContaining(['Nightly backup & restart', 'Welcome new players', 'Wake-up check']));
    const runs = await api.automationRuns('fixture-survival', null);
    expect(new Set(runs.items.map((run) => run.state))).toEqual(new Set(['succeeded', 'failed', 'suspended']));
    const failed = runs.items.find((run) => run.state === 'failed');
    const steps = await api.automationRunSteps('fixture-survival', failed.id, null);
    expect(steps.items.at(-1).errorCode).toBe('timed_out');
    for (const item of items) expect(draftProblems({ name: item.name, executionPrincipalId: item.executionPrincipalId, definition: (await api.automationWorkflow('fixture-survival', item.id)).definition })).toEqual([]);
  });
  test('revisions: stale writes are refused', async () => {
    const api = servers();
    const created = await api.automationWorkflowCreate('fixture-survival', wire(), true, 'c1');
    expect(created.revision).toBe(1);
    const updated = await api.automationWorkflowUpdate('fixture-survival', created.workflowId, 1, wire({ name: 'Renamed' }), 'u1');
    expect(updated.revision).toBe(2);
    await expect(api.automationWorkflowUpdate('fixture-survival', created.workflowId, 1, wire({ name: 'Again' }), 'u2')).rejects.toMatchObject({ code: 'stale_target' });
    await expect(api.automationWorkflowSetEnabled('fixture-survival', created.workflowId, 1, false, 'e1')).rejects.toMatchObject({ code: 'stale_target' });
    await expect(api.automationWorkflowDelete('fixture-survival', created.workflowId, 1, 'd1')).rejects.toMatchObject({ code: 'stale_target' });
    expect((await api.automationWorkflow('fixture-survival', created.workflowId)).name).toBe('Renamed');
  });
  test('invalid definitions and replayed intents', async () => {
    const api = servers();
    await expect(api.automationWorkflowCreate('fixture-survival', wire({ trigger: { kind: 'interval', seconds: 30 } }), true, 'bad')).rejects.toMatchObject({ code: 'invalid_input' });
    const first = await api.automationWorkflowCreate('fixture-survival', wire(), true, 'same');
    const again = await api.automationWorkflowCreate('fixture-survival', wire(), true, 'same');
    expect(again).toEqual(first);
    await expect(api.automationWorkflowCreate('fixture-survival', wire({ name: 'Other' }), true, 'same')).rejects.toMatchObject({ code: 'conflict' });
  });
  test('manual runs need an enabled workflow with the manual trigger', async () => {
    const api = servers();
    const scheduled = await api.automationWorkflowCreate('fixture-survival', wire(), true, 'm0');
    await expect(api.automationWorkflowRun('fixture-survival', scheduled.workflowId, 'r0')).rejects.toMatchObject({ code: 'conflict' });
    const manual = fromEditorDraft(templateDraft('blank', { name: 'Ping', principalId: 'p-self', offsetMinutes: 0 }));
    const off = await api.automationWorkflowCreate('fixture-survival', manual, false, 'm1');
    await expect(api.automationWorkflowRun('fixture-survival', off.workflowId, 'r1')).rejects.toMatchObject({ code: 'conflict' });
    await api.automationWorkflowSetEnabled('fixture-survival', off.workflowId, off.revision, true, 'm2');
    const run = await api.automationWorkflowRun('fixture-survival', off.workflowId, 'r2');
    expect(run).toMatchObject({ skipped: false });
    const second = await api.automationWorkflowRun('fixture-survival', off.workflowId, 'r3');
    expect(second).toEqual({ workflowId: off.workflowId, runId: null, skipped: true });
    const detail = await api.automationRun('fixture-survival', run.runId);
    expect(detail.trigger).toEqual({ kind: 'manual' });
  });
  test('deleting a workflow keeps its run history', async () => {
    const api = servers();
    const { items } = await api.automationWorkflows('fixture-survival', null);
    const nightly = items.find((item) => item.name === 'Nightly backup & restart');
    const before = (await api.automationWorkflowRuns('fixture-survival', nightly.id, null)).items.length;
    expect(before).toBeGreaterThan(0);
    await api.automationWorkflowDelete('fixture-survival', nightly.id, nightly.revision, 'del');
    await expect(api.automationWorkflow('fixture-survival', nightly.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await api.automationWorkflowRuns('fixture-survival', nightly.id, null)).items).toHaveLength(before);
    expect((await api.automationRuns('fixture-survival', null)).items.filter((run) => run.workflowId === nightly.id)).toHaveLength(before);
  });
  test('discard is only for suspended runs and never cancels the operation', async () => {
    const api = servers();
    const runs = (await api.automationRuns('fixture-survival', null)).items;
    const finished = runs.find((run) => run.state === 'succeeded');
    await expect(api.automationRunDiscard('fixture-survival', finished.id, 'x1')).rejects.toMatchObject({ code: 'conflict' });
    const suspended = runs.find((run) => run.state === 'suspended');
    await api.automationRunDiscard('fixture-survival', suspended.id, 'x2');
    expect(await api.automationRun('fixture-survival', suspended.id)).toMatchObject({ state: 'failed', outcomeCode: 'discarded' });
  });
  test('viewers can read nothing and change nothing', async () => {
    const api = servers();
    await expect(api.automationWorkflows('fixture-creative', null)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.automationWorkflowCreate('fixture-creative', wire(), true, 'v1')).rejects.toMatchObject({ code: 'forbidden' });
  });
  test('the execution principal must rank below the caller unless it is the caller', async () => {
    const host = {
      server: (id) => (id === 'srv' ? {} : (() => { throw { code: 'not_found' }; })()),
      requireCapability: () => {},
      wait: async () => {},
      principals: async () => ({ selfId: 'p-admin', ranks: { 'p-owner': 100, 'p-admin': 90, 'p-admin-2': 90, 'p-mod': 40 } }),
    };
    const api = createAutomationFixtures(host);
    const as = (principal) => fromEditorDraft({ ...draft(), executionPrincipalId: principal });
    await expect(api.automationWorkflowCreate('srv', as('p-admin'), true, 'a')).resolves.toMatchObject({ revision: 1 });
    await expect(api.automationWorkflowCreate('srv', as('p-mod'), true, 'b')).resolves.toMatchObject({ revision: 1 });
    await expect(api.automationWorkflowCreate('srv', as('p-admin-2'), true, 'c')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.automationWorkflowCreate('srv', as('p-owner'), true, 'd')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.automationWorkflowCreate('srv', as('p-ghost'), true, 'e')).rejects.toMatchObject({ code: 'not_found' });
    // Changing a workflow the caller couldn't have created is refused too.
    const mine = await api.automationWorkflowCreate('srv', as('p-mod'), true, 'f');
    await expect(api.automationWorkflowUpdate('srv', mine.workflowId, 1, as('p-owner'), 'g')).rejects.toMatchObject({ code: 'forbidden' });
    expect(await api.automationSelf('srv')).toEqual({ principalId: 'p-admin', rank: 90 });
  });
});

test("step output renders as readable fields", async () => {
  const { outputFields } = await import("../src/features/servers/automation-model.ts");
  expect(outputFields(null)).toBeNull();
  expect(outputFields({})).toBeNull();
  expect(outputFields({ stdin_written: true })).toEqual([{ label: "Stdin written", value: true }]);
  expect(outputFields({ snapshot: "77ad", files_changed: 208, extra: { a: 1 } })).toEqual([
    { label: "Snapshot", value: "77ad" },
    { label: "Files changed", value: "208" },
    { label: "Extra", value: '{"a":1}' },
  ]);
  expect(outputFields("done")).toEqual([{ label: "", value: "done" }]);
});
