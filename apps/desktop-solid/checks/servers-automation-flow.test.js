import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import {
  dragShift, dropTarget, followIndex, keyboardTarget, newStep, nextRunPoll, reorderSteps, RUN_POLL_MAX_MS, RUN_POLL_MS, shownRunDetail,
  startRunPoll, stepSummary, templateDraft, workflowProblems,
} from '../src/features/servers/automation-model';

const run = (state, id = `run-${state}`) => ({ id, workflowId: 'wf', state, currentStep: 0, attempt: 0, startedAtMs: 1, finishedAtMs: null, trigger: { kind: 'manual' } });
const steady = () => 0;

describe('[flow] dragging, keyboard and move buttons agree on the order', () => {
  test('cards slide aside exactly where the dragged step will land', () => {
    const steps = ['a', 'b', 'c', 'd'];
    // Dragging `d` (3) to the top: everything above it slides down one slot.
    expect(steps.map((_, at) => dragShift(at, 3, 0))).toEqual([1, 1, 1, 0]);
    expect(reorderSteps(steps, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    // Dragging `a` (0) to position 2: the two it passes slide up.
    expect(steps.map((_, at) => dragShift(at, 0, 2))).toEqual([0, -1, -1, 0]);
    expect(reorderSteps(steps, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(steps.map((_, at) => dragShift(at, 1, 1))).toEqual([0, 0, 0, 0]);
  });
  test('drop position comes from fixed midpoints of the other cards', () => {
    // Midpoints of b, c, d while `a` is dragged; above all → 0, between c and d → 2, past d → 3.
    const others = [100, 160, 220];
    expect(dropTarget(others, 40)).toBe(0);
    expect(dropTarget(others, 190)).toBe(2);
    expect(dropTarget(others, 400)).toBe(3);
  });
  test('the open step follows its card, and keyboard moves stop at the ends', () => {
    expect(followIndex(3, 3, 0)).toBe(0);
    expect(followIndex(0, 3, 0)).toBe(1);
    expect(followIndex(2, 0, 1)).toBe(2);
    expect(keyboardTarget(0, 3, 'ArrowUp')).toBeNull();
    expect(keyboardTarget(0, 3, 'ArrowDown')).toBe(1);
    expect(keyboardTarget(1, 3, 'End')).toBe(2);
    expect(keyboardTarget(2, 3, 'Home')).toBe(0);
    expect(keyboardTarget(1, 3, 'x')).toBeNull();
    // The details panel's Move up / Move down use the same reorder.
    expect(reorderSteps(['a', 'b', 'c'], 1, 1 - 1)).toEqual(['b', 'a', 'c']);
    expect(reorderSteps(['a', 'b', 'c'], 2, 3)).toEqual(['a', 'b', 'c']);
  });
});

describe('[flow] validation after reordering', () => {
  const base = () => {
    const draft = templateDraft('blank', { name: 'Flow', principalId: 'p-self', offsetMinutes: 0 });
    const first = newStep('console_command', [], undefined);
    first.action = { kind: 'console_command', line: 'say hi' };
    const second = newStep('delay', [first]);
    const third = newStep('restart', [first, second]);
    // The first step jumps over the delay on failure.
    first.onFailure = { kind: 'goto', stepId: third.id };
    return { ...draft, steps: [first, second, third] };
  };
  test('a forward jump is valid; dragging its target above it is flagged on that step', () => {
    const draft = base();
    expect(workflowProblems(draft).map((problem) => problem.path)).toEqual([]);
    const moved = { ...draft, steps: reorderSteps(draft.steps, 2, 0) };
    const paths = workflowProblems(moved).map((problem) => problem.path);
    // The jumping step is now at index 1 and its target sits behind it.
    expect(paths).toContain('steps.1.onFailure');
    // Jumps keep pointing at the same step id; nothing was silently rewritten.
    expect(moved.steps[1].onFailure).toEqual({ kind: 'goto', stepId: draft.steps[2].id });
  });
  test('an empty field reads as the kind of step, not as empty quotes', () => {
    expect(stepSummary({ kind: 'console_command', line: '  ' })).toEqual({ message: 'server-automation.action-console', args: {} });
    expect(stepSummary({ kind: 'notify', severity: 'info', title: '', body: '' }).message).toBe('server-automation.action-notify');
    expect(stepSummary({ kind: 'backup', profile: '' }).message).toBe('server-automation.action-backup');
    expect(stepSummary({ kind: 'console_command', line: 'say hi' }).message).toBe('server-automation.step-console');
  });
});

describe('[runs] history polling', () => {
  test('polls only while something is moving; a suspended run waits for a person', () => {
    expect(nextRunPoll(undefined, null, 0)).toBeNull();
    expect(nextRunPoll([run('succeeded'), run('suspended')], null, 0)).toBeNull();
    expect(nextRunPoll([run('running')], null, 0)).toBe(RUN_POLL_MS);
    expect(nextRunPoll([run('queued')], null, 0)).toBe(RUN_POLL_MS);
  });
  test('transient failures back off up to a cap and never undercut Retry-After', () => {
    const moving = [run('running')];
    const delays = [1, 2, 3, 4, 5, 9].map((failures) => nextRunPoll(moving, { code: 'unreachable' }, failures, steady));
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, RUN_POLL_MAX_MS]);
    expect(nextRunPoll(moving, { code: 'server_busy', retryAfterMs: 45_000 }, 1, steady)).toBe(45_000);
    expect(nextRunPoll(moving, { code: 'rate_limited', retryAfterMs: 2 ** 40 }, 1, steady)).toBeNull();
    expect(nextRunPoll(moving, { code: 'unreachable' }, 1, () => 1)).toBe(6_000);
  });
  test('lasting failures stop polling', () => {
    for (const code of ['forbidden', 'not_found', 'credentials_rejected', 'unsupported']) {
      expect(nextRunPoll([run('running')], { code }, 1, steady)).toBeNull();
    }
  });
});

/** A manual clock: timers run only when the test says so. */
function fakeTimers() {
  const timers = new Map();
  let next = 0;
  return {
    timers,
    setTimer: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    fire: async () => {
      const [id, timer] = [...timers][0];
      timers.delete(id);
      timer.fn();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
    delays: () => [...timers.values()].map((timer) => timer.ms),
  };
}

describe('[runs] one transient error does not stop following active runs (finding #2)', () => {
  test('active → failed poll → recovery → polling continues without user input', async () => {
    const clock = fakeTimers();
    let shown = { runs: [run('running', 'r1')], error: null };
    const replies = [
      () => { shown = { ...shown, error: { code: 'unreachable' } }; },
      () => { shown = { runs: [{ ...run('running', 'r1'), currentStep: 1 }], error: null }; },
      () => { shown = { runs: [run('succeeded', 'r1')], error: null }; },
    ];
    let reads = 0;
    const stop = startRunPoll({
      refresh: async () => { replies[reads++](); },
      current: () => shown, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random: steady,
    });
    expect(clock.delays()).toEqual([RUN_POLL_MS]);
    await clock.fire();
    // The failed read keeps the last runs on screen and re-arms with backoff.
    expect(shown.error).toEqual({ code: 'unreachable' });
    expect(clock.delays()).toEqual([RUN_POLL_MS]);
    await clock.fire();
    expect(shown.runs[0].currentStep).toBe(1);
    expect(clock.delays()).toEqual([RUN_POLL_MS]);
    await clock.fire();
    // Finished: no timer left.
    expect(reads).toBe(3);
    expect(clock.timers.size).toBe(0);
    stop();
  });
  test('backoff grows across consecutive failures and resets after success', async () => {
    const clock = fakeTimers();
    let shown = { runs: [run('running')], error: null };
    const outcomes = ['busy', 'busy', 'busy', 'ok'];
    let reads = 0;
    startRunPoll({
      refresh: async () => { shown = { ...shown, error: outcomes[reads++] === 'busy' ? { code: 'server_busy' } : null }; },
      current: () => shown, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random: steady,
    });
    const seen = [];
    for (let i = 0; i < 4; i++) { await clock.fire(); seen.push(clock.delays()[0]); }
    expect(seen).toEqual([5_000, 10_000, 20_000, 5_000]);
  });
  test('server pressure and a hidden window hold the poll without a request', async () => {
    const clock = fakeTimers();
    let hold = 30_000;
    let reads = 0;
    startRunPoll({
      refresh: async () => { reads++; }, current: () => ({ runs: [run('running')], error: null }),
      holdFor: () => hold, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random: steady,
    });
    await clock.fire();
    expect(reads).toBe(0);
    expect(clock.delays()).toEqual([30_000]);
    hold = 0;
    await clock.fire();
    expect(reads).toBe(1);
  });
  test('stopping cancels the timer and ignores a read still in flight', async () => {
    const clock = fakeTimers();
    let release;
    const stop = startRunPoll({
      refresh: () => new Promise((resolve) => { release = resolve; }),
      current: () => ({ runs: [run('running')], error: null }), setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    });
    await clock.fire();
    stop();
    release();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(clock.timers.size).toBe(0);
  });
});

describe('[runs] run detail refreshes cannot apply out of order (finding #3)', () => {
  test('the previous detail of the same run stays up while a newer one loads', () => {
    const older = { run: { id: 'r1' }, rows: ['old'] };
    const newer = { run: { id: 'r1' }, rows: ['new'] };
    expect(shownRunDetail(undefined, undefined, 'r1')).toBeUndefined();
    expect(shownRunDetail(older, undefined, 'r1')).toBe(older);
    expect(shownRunDetail(older, newer, 'r1')).toBe(newer);
    // Never another run's detail.
    expect(shownRunDetail(older, undefined, 'r2')).toBeUndefined();
  });

  test('a slower answer for an earlier progress key never replaces the newer one', async () => {
    const check = await buildHarness();
    const pending = new Map();
    const def = check.serverResource('check-run-detail', (_id, args) => new Promise((resolve) => pending.set(args.progress, resolve)));
    const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); check.flush(); };
    const owner = check.createRoot((dispose) => {
      const [progress, setProgress] = check.createSignal('running:0:0');
      const detail = check.useServerResource(() => 'conn-detail', def, { args: () => ({ runId: 'r1', progress: progress() }) });
      const shown = check.createMemo((previous) => check.shownRunDetail(previous, detail.value(), 'r1'));
      return { dispose, setProgress, shown };
    });
    try {
      await settle();
      expect(pending.has('running:0:0')).toBe(true);
      // The run moves on before the first read answers.
      owner.setProgress('running:1:0'); await settle();
      expect(pending.has('running:1:0')).toBe(true);
      pending.get('running:1:0')({ run: { id: 'r1' }, rows: ['step 2'] }); await settle();
      expect(check.untrack(owner.shown).rows).toEqual(['step 2']);
      // The earlier, slower read lands last and is ignored.
      pending.get('running:0:0')({ run: { id: 'r1' }, rows: ['step 1'] }); await settle();
      expect(check.untrack(owner.shown).rows).toEqual(['step 2']);
      // Another move: the newer detail stays visible until its own read answers.
      owner.setProgress('succeeded:1:0'); await settle();
      expect(check.untrack(owner.shown).rows).toEqual(['step 2']);
      pending.get('succeeded:1:0')({ run: { id: 'r1' }, rows: ['done'] }); await settle();
      expect(check.untrack(owner.shown).rows).toEqual(['done']);
    } finally { owner.dispose(); }
  });
});

let built;
async function buildHarness() {
  if (built) return built;
  const resourcesPath = fileURLToPath(new URL('../src/features/servers/resources.ts', import.meta.url));
  const modelPath = fileURLToPath(new URL('../src/features/servers/automation-model.ts', import.meta.url));
  const result = await Bun.build({
    entrypoints: ['vesta-automation-flow-check'], target: 'bun', conditions: ['browser', 'development'],
    plugins: [{ name: 'automation-flow-check', setup(build) {
      build.onResolve({ filter: /^vesta-automation-flow-check$/ }, () => ({ path: 'check', namespace: 'automation-check' }));
      build.onLoad({ filter: /.*/, namespace: 'automation-check' }, () => ({ loader: 'js', resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
        export { createMemo, createRoot, createSignal, flush, untrack } from 'solid-js';
        export { serverResource, useServerResource } from ${JSON.stringify(resourcesPath)};
        export { shownRunDetail } from ${JSON.stringify(modelPath)};
      ` }));
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs, 'harness build failed');
  const source = await result.outputs[0].text();
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  built = await import(url);
  return built;
}
