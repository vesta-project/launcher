import { expect, test } from 'bun:test';
import {
  agentJobActive, agentPhase, cancellablePhase, effectivePhase, formatBytes, formatElapsed, isActivePhase, isQuiet,
  jobError, jobSteps, progressSignature, progressView, QUIET_AFTER_MS,
} from '../src/features/servers/pack-install-job.ts';

const job = (state, error = null, id = 'job-1') => ({ id, state, error });

test('agent job states map to what the person sees, including restart recovery', () => {
  expect(agentPhase(job('queued'))).toBe('installing');
  expect(agentPhase(job('staging'))).toBe('installing');
  expect(agentPhase(job('activating'))).toBe('switching');
  expect(agentPhase(job('succeeded'))).toBe('succeeded');
  // Agent restart: queued/staging fail as interrupted (nothing activated), activating needs recovery.
  expect(agentPhase(job('failed', 'software_staging_interrupted'))).toBe('interrupted');
  expect(agentPhase(job('recovery_required'))).toBe('recovery');
  expect(agentPhase(job('failed', 'pack_integrity_failure'))).toBe('failed');
  expect(agentPhase(null)).toBeNull();
  expect(agentPhase(job('mystery'))).toBeNull();
});

test('only queued, staging and activating hold the server against a second install', () => {
  for (const state of ['queued', 'staging', 'activating']) expect(agentJobActive(job(state))).toBe(true);
  for (const state of ['succeeded', 'failed', 'recovery_required']) expect(agentJobActive(job(state))).toBe(false);
  expect(agentJobActive(null)).toBe(false);
});

test('a previous finished agent job never ends a new install early', () => {
  expect(effectivePhase('installing', job('succeeded'), null)).toBe('installing');
  // Apply accepted job-2, but the workspace still reports the old job-1.
  expect(effectivePhase('installing', job('succeeded', null, 'job-1'), 'job-2')).toBe('installing');
  expect(effectivePhase('installing', job('failed', 'x', 'job-1'), 'job-2')).toBe('installing');
  // Once the accepted job reports, it is the truth.
  expect(effectivePhase('installing', job('activating', null, 'job-2'), 'job-2')).toBe('switching');
  expect(effectivePhase('installing', job('succeeded', null, 'job-2'), 'job-2')).toBe('succeeded');
  // Local steps win while the launcher runs them; with no local step the agent job shows.
  expect(effectivePhase('backing-up', job('succeeded'), null)).toBe('backing-up');
  expect(effectivePhase(null, job('staging'), null)).toBe('installing');
  expect(effectivePhase(null, null, null)).toBeNull();
});

test('only launcher-owned work can be cancelled; agent writes finish', () => {
  expect(cancellablePhase('preparing')).toBe(true);
  expect(cancellablePhase('backing-up')).toBe(true);
  for (const phase of ['installing', 'switching', 'resetting-world', 'succeeded', 'failed', null]) expect(cancellablePhase(phase)).toBe(false);
  expect(isActivePhase('preparing')).toBe(true);
  expect(isActivePhase('failed')).toBe(false);
});

test('preparation shows real stage text and honest progress, never a stuck 0%', () => {
  // Resolving the pack reports 0/0 for up to two minutes: indeterminate with words.
  const resolving = progressView('preparing', { stage: 'archive', completed: 0, total: 0 });
  expect(resolving).toEqual({ stage: 'server-pack.job-stage-archive', items: null, bytes: null, percent: undefined });
  // Downloads stream bytes with no total.
  const downloading = progressView('preparing', { stage: 'download_verify', completed: 0, total: 0, bytesCompleted: 44 * 1048576 });
  expect(downloading.stage).toBe('server-pack.job-stage-download');
  expect(downloading.bytes).toBe(44 * 1048576);
  expect(downloading.percent).toBeUndefined();
  // Counted stages give a real percentage and counter.
  const hashing = progressView('preparing', { stage: 'extract_hash', completed: 30, total: 120 });
  expect(hashing).toMatchObject({ stage: 'server-pack.job-stage-extract', items: { completed: 30, total: 120 }, percent: 25 });
  // Over-reporting never exceeds 100%.
  expect(progressView('installing', { stage: 'writing', completed: 130, total: 120 }).percent).toBe(100);
  // No agent progress yet: the phase itself is the text.
  expect(progressView('preparing', null).stage).toBe('server-pack.job-phase-preparing');
  // Steps without agent progress ignore a stale progress row.
  expect(progressView('backing-up', { stage: 'writing', completed: 1, total: 2 }).stage).toBe('server-pack.job-phase-backing-up');
  // Unknown stages from a newer agent fall back to the phase.
  expect(progressView('installing', { stage: 'quantum', completed: 1, total: 2 }).stage).toBe('server-pack.job-phase-installing');
});

test('a quiet stage is explained after a while instead of looking frozen', () => {
  const start = 1_000_000;
  expect(isQuiet('preparing', start, start + QUIET_AFTER_MS - 1)).toBe(false);
  expect(isQuiet('preparing', start, start + QUIET_AFTER_MS)).toBe(true);
  expect(isQuiet('failed', start, start + QUIET_AFTER_MS * 10)).toBe(false);
  // Movement changes the signature, which resets the quiet timer in the store.
  const a = progressSignature('preparing', { stage: 'download_verify', completed: 0, total: 0, bytesCompleted: 1 });
  const b = progressSignature('preparing', { stage: 'download_verify', completed: 0, total: 0, bytesCompleted: 2 });
  expect(a).not.toBe(b);
  expect(progressSignature('preparing', null)).toBe(progressSignature('preparing', undefined));
});

test('sizes and elapsed time read naturally', () => {
  expect(formatBytes(300)).toBe('1 KB');
  expect(formatBytes(512 * 1024)).toBe('512 KB');
  expect(formatBytes(4.25 * 1048576)).toBe('4.3 MB');
  expect(formatBytes(132.4 * 1048576)).toBe('132 MB');
  expect(formatBytes(2.5 * 1073741824)).toBe('2.50 GB');
  expect(formatElapsed(42_000)).toBe('0:42');
  expect(formatElapsed(185_000)).toBe('3:05');
  expect(formatElapsed(3_729_000)).toBe('1:02:09');
  expect(formatElapsed(-5)).toBe('0:00');
});

test('steps follow the chosen plan and show where the install is', () => {
  const shape = { backup: true, softwareSwitch: true, resetWorld: true, adopted: false };
  const states = (phase, failedAt) => jobSteps(shape, phase, failedAt).map((step) => `${step.id}:${step.state}`);
  expect(states('preparing')).toEqual(['prepare:current', 'backup:upcoming', 'install:upcoming', 'switch:upcoming', 'world:upcoming']);
  expect(states('installing')).toEqual(['prepare:done', 'backup:done', 'install:current', 'switch:upcoming', 'world:upcoming']);
  expect(states('switching')).toEqual(['prepare:done', 'backup:done', 'install:done', 'switch:current', 'world:upcoming']);
  expect(states('succeeded')).toEqual(['prepare:done', 'backup:done', 'install:done', 'switch:done', 'world:done']);
  expect(states('failed', 'backup')).toEqual(['prepare:done', 'backup:failed', 'install:upcoming', 'switch:upcoming', 'world:upcoming']);
  expect(states('failed', 'world')).toEqual(['prepare:done', 'backup:done', 'install:done', 'switch:done', 'world:failed']);
  // Plain installs only list what happens.
  expect(jobSteps({ backup: false, softwareSwitch: false, resetWorld: false, adopted: false }, 'installing').map((s) => s.id)).toEqual(['prepare', 'install']);
});

test('an install picked up after a restart only shows the agent steps it knows', () => {
  const adopted = { backup: false, softwareSwitch: false, resetWorld: false, adopted: true };
  expect(jobSteps(adopted, 'installing').map((s) => `${s.id}:${s.state}`)).toEqual(['install:current']);
  // A switch discovered while adopted is shown, not invented in advance.
  expect(jobSteps(adopted, 'switching').map((s) => `${s.id}:${s.state}`)).toEqual(['install:done', 'switch:current']);
  expect(jobSteps(adopted, 'interrupted').map((s) => `${s.id}:${s.state}`)).toEqual(['install:failed']);
  expect(jobSteps({ ...adopted, softwareSwitch: true }, 'recovery').map((s) => `${s.id}:${s.state}`)).toEqual(['install:done', 'switch:failed']);
});

test('agent job errors reach the shared error presentation as reasons', () => {
  expect(jobError(job('failed', 'software_staging_interrupted'))).toEqual({ code: 'conflict', reason: 'software_staging_interrupted', retryAfterMs: null });
  expect(jobError(job('succeeded'))).toBeNull();
  expect(jobError(null)).toBeNull();
});

test('activation shows file writing progress and adopted recovery marks the switch failed', () => {
  expect(progressView('switching', { stage: 'writing', completed: 146, total: 664 })).toMatchObject({ stage: 'server-pack.job-stage-writing', items: { completed: 146, total: 664 } });
  expect(jobSteps({ adopted: true, backup: false, softwareSwitch: false, resetWorld: false }, 'recovery').map(s => `${s.id}:${s.state}`)).toEqual(['install:done', 'switch:failed']);
});
