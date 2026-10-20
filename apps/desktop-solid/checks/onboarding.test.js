import { describe, expect, test } from 'bun:test';
import { OnboardingFlow, hostSteps, resumeStep, resolveSetup } from '../src/features/onboarding/flow';
const microsoft = { account_type: 'Microsoft', is_expired: false };
const guest = { account_type: 'Guest', is_expired: false };
function setup(config = {}, initialAccount = null) {
  let account = initialAccount;
  const calls = { persisted: [], reset: 0, complete: 0, guest: 0, routes: [], cancel: 0 };
  const flow = new OnboardingFlow({
    config: async () => config, account: async () => account,
    persist: async (step) => { calls.persisted.push(step); },
    reset: async () => { calls.reset++; }, complete: async () => { calls.complete++; },
    guest: async () => { calls.guest++; account = guest; },
    cancelLogin: async () => { calls.cancel++; }, enter: (path) => calls.routes.push(path),
    prefetch: () => {}, authRequired: () => new Error('auth required'),
  }, () => {});
  return { flow, calls, login: () => { account = microsoft; } };
}
describe('onboarding startup resolution', () => {
  test('keeps host numbering, skips Learn and normalizes invalid resume data', () => {
    expect(hostSteps.theme).toBe(4);
    expect(resumeStep(3)).toBe('theme'); expect(resumeStep('bad')).toBe('splash');
    expect(resumeStep(-20)).toBe('splash'); expect(resumeStep(100)).toBe('complete');
    expect(resolveSetup({ setup_step: 3 }, microsoft).step).toBe('theme');
  });
  test('resumes setup, skipping auth only with a valid account', () => {
    expect(resolveSetup({ setup_step: 5 }, microsoft)).toMatchObject({ step: 'first-instance', loginOnly: false, status: 'active' });
    expect(resolveSetup({ setup_step: 2 }, microsoft).step).toBe('theme');
    expect(resolveSetup({ setup_step: 6 }, null).step).toBe('auth');
  });
  test('completed setup requires valid account or enters loginOnly', () => {
    const config = { setup_completed: true, setup_step: 6 };
    expect(resolveSetup(config, microsoft).status).toBe('done');
    for (const account of [null, { ...microsoft, is_expired: true }])
      expect(resolveSetup(config, account)).toMatchObject({ step: 'auth', loginOnly: true, status: 'active' });
    expect(resolveSetup(config, microsoft, true)).toMatchObject({ step: 'auth', status: 'active', loginOnly: true });
  });
  test('recovers legacy early completion and stale guest/demo', async () => {
    for (const [config, account] of [[{ setup_completed: true, setup_step: 1 }, microsoft], [{ setup_step: 5 }, guest]]) {
      const { flow, calls } = setup(config, account); await flow.initialize();
      expect(calls.reset).toBe(1);
      expect(flow.state).toMatchObject({ status: 'active', step: 'splash', loginOnly: false });
    }
    expect(resolveSetup({ setup_completed: true, setup_step: 6 }, { account_type: ' demo ' })).toMatchObject({ reset: true, step: 'splash', completed: false });
  });
});
describe('onboarding navigation and completion', () => {
  test('auth guards forward flow and completion; Back returns to splash', async () => {
    const { flow, calls } = setup(); await flow.initialize();
    await flow.next(); expect(flow.state.step).toBe('credits');
    await flow.next(); expect(flow.state.step).toBe('auth');
    await flow.next(); expect(flow.state.step).toBe('auth');
    await flow.goTo('complete'); expect(flow.state.step).toBe('auth');
    await expect(flow.finish()).rejects.toThrow('auth required'); expect(calls.complete).toBe(0);
    await flow.back(); expect(flow.state).toMatchObject({ step: 'splash', direction: -1 });
  });
  test('complete_onboarding runs once across overlapping and repeated finish', async () => {
    const { flow, calls } = setup({ setup_step: 6 }, microsoft); await flow.initialize();
    await Promise.all([flow.finish(), flow.next(), flow.finish()]); await flow.finish();
    expect(calls.complete).toBe(1); expect(calls.routes).toEqual(['/library']); expect(flow.state.status).toBe('done');
  });
  test('loginOnly completion never calls complete_onboarding again', async () => {
    const { flow, login, calls } = setup({ setup_completed: true, setup_step: 6 }); await flow.initialize();
    expect(flow.canGoBack()).toBe(false); await flow.back(); expect(flow.state.step).toBe('auth');
    login(); await flow.authenticated(); expect(calls.complete).toBe(0); expect(flow.state.status).toBe('done');
  });
  test('guest exploration leaves setup incomplete, signing in continues remaining steps', async () => {
    const { flow, calls, login } = setup(); await flow.initialize(); await flow.continueAsGuest();
    expect(flow.state).toMatchObject({ status: 'done', guest: true }); expect(calls.guest).toBe(1); expect(calls.complete).toBe(0);
    flow.signInFromGuest(); expect(flow.state).toMatchObject({ step: 'auth', loginOnly: true, status: 'active' }); expect(flow.canGoBack()).toBe(false);
    login(); await flow.authenticated(); expect(flow.state).toMatchObject({ step: 'theme', loginOnly: false, guest: false });
    await flow.next(); expect(flow.state.step).toBe('first-instance'); await flow.next(); expect(flow.state.step).toBe('complete');
    await flow.finish(); expect(calls.complete).toBe(1);
  });
  test('import finishes into existing route; reset reactivates splash', async () => {
    const { flow, calls } = setup({ setup_step: 5 }, microsoft); await flow.initialize(); await flow.finish('/create/import/prism');
    expect(calls.routes).toEqual(['/create/import/prism']); await flow.reset();
    expect(flow.state).toMatchObject({ status: 'active', step: 'splash', loginOnly: false });
    await flow.finish(); expect(calls.complete).toBe(2);
  });
});
