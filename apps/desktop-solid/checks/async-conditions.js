import { setImmediate } from 'node:timers/promises';

// Drain promise continuations before Solid publishes their writes. Negative
// assertions need a turn barrier because there is no event to wait for.
export async function settleReactive(api) {
  api.flush();
  await setImmediate();
  api.flush();
}

export async function waitForReactive(api, predicate, description, timeoutMs = 3000) {
  const deadline = performance.now() + timeoutMs;
  do {
    api.flush();
    if (predicate()) return;
    await setImmediate();
  } while (performance.now() < deadline);
  api.flush();
  if (!predicate()) throw new Error(`Timed out waiting for ${description}`);
}
