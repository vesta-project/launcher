import { describe, expect, test } from 'bun:test';
import { LoginSession } from '../src/features/accounts/login-session';

function setup(overrides = {}) {
  let receive;
  const states = [];
  const calls = { start: 0, stop: 0, cancel: 0, complete: 0 };
  const session = new LoginSession({
    listen: async (handler) => { receive = handler; return () => calls.stop++; },
    start: async () => { calls.start++; },
    cancel: async () => { calls.cancel++; },
    complete: () => { calls.complete++; },
    ...overrides,
  }, (state) => states.push(state));
  return { session, calls, states, emit: (event) => receive(event) };
}

describe('native account login', () => {
  test('subscribes before starting and keeps the device code during Polling', async () => {
    const { session, emit, calls, states } = setup();
    await session.start();
    emit({ stage: 'AuthCode', code: 'ABCD-EFGH', url: 'https://www.microsoft.com/link', expires_in: 900 });
    emit({ stage: 'Polling' });
    expect(states.at(-1)).toMatchObject({ open: true, phase: 'waiting', code: 'ABCD-EFGH' });
    expect(states.at(-1).expiresAt).toBeGreaterThan(Date.now());
    await session.start();
    expect(calls.start).toBe(1);
    emit({ stage: 'Complete', user_uuid: 'uuid', user_username: 'Player' });
    expect(states.at(-1).open).toBe(false);
    expect(calls.complete).toBe(1);
    expect(calls.stop).toBe(1);
    emit({ stage: 'Complete', user_uuid: 'uuid', user_username: 'Player' });
    expect(calls.complete).toBe(1);
  });

  test('native Error events are failures even when start_login resolved successfully', async () => {
    const { session, emit, states, calls } = setup();
    await session.start();
    emit({ stage: 'Error', code: 'offline', message: 'Connection failed', retryable: true });
    expect(states.at(-1)).toMatchObject({ open: true, phase: 'error', error: 'Connection failed' });
    await session.start();
    expect(calls.start).toBe(2);
    expect(states.at(-1).code).toBeUndefined();
  });

  test('close during listener registration prevents native login and disposes late registration', async () => {
    let resolveListen;
    let stopped = 0;
    const { session, calls } = setup({ listen: () => new Promise((resolve) => { resolveListen = resolve; }) });
    const request = session.start();
    await session.close();
    resolveListen(() => stopped++);
    await request;
    expect(calls.start).toBe(0);
    expect(stopped).toBe(1);
  });

  test('close during slow start rejects late events and cancels after native setup settles', async () => {
    let finish;
    const work = new Promise((resolve) => { finish = resolve; });
    const { session, emit, states, calls } = setup({ start: () => work });
    const request = session.start();
    await Promise.resolve();
    await session.close();
    emit({ stage: 'AuthCode', code: 'late', url: 'https://www.microsoft.com/link', expires_in: 900 });
    expect(states.at(-1).open).toBe(false);
    finish();
    await request;
    expect(calls.cancel).toBe(2);
    expect(calls.stop).toBe(1);
  });
});
