import { createEffect, createMemo, createSignal, onSettled, untrack } from 'solid-js';
import type { ServerCommandError } from './native';

/** Read-only refresh policy. Mutations must never use this retry path. */
export function readRetryDelay(error: ServerCommandError, failures: number): number | null {
  if (!['timeout', 'unreachable', 'outcome_unknown', 'server_busy', 'rate_limited'].includes(error.code)) return null;
  const guidance = error.retryAfterMs ?? 0;
  if (!Number.isFinite(guidance) || guidance > 2_147_483_647) return null;
  const backoff = Math.min(60_000, 2500 * 2 ** Math.min(Math.max(failures - 1, 0), 5));
  // Jitter cannot shorten server Retry-After guidance.
  return Math.max(guidance, Math.round(backoff * (1 + Math.random() * 0.2)));
}

/** A view-owned read: stable keys, latest response wins, one timer, no writes after disposal. */
export function createServerRead<T>(options: {
  key: () => string;
  read: (key: string, signal: AbortSignal) => Promise<T>;
  pollAfter?: (value: T) => number | null;
  retry?: boolean;
  name: string;
}) {
  const key = createMemo(options.key, { name: `${options.name}:key` });
  const [value, setValue] = createSignal<T | null>(null, { name: `${options.name}:value` });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: `${options.name}:error` });
  let sequence = 0;
  let disposed = false;
  let failures = 0;
  let active: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    if (disposed) return;
    clearTimeout(timer);
    active?.abort();
    active = new AbortController();
    const request = ++sequence;
    const requestedKey = untrack(key);
    const current = () => !disposed && request === sequence && requestedKey === untrack(key);
    try {
      const next = await options.read(requestedKey, active.signal);
      if (!current()) return;
      failures = 0;
      setValue(() => next);
      setError(null);
      const delay = options.pollAfter?.(next);
      if (delay != null) timer = setTimeout(() => void refresh(), delay);
    } catch (reason) {
      if (!current()) return;
      const failure = reason as ServerCommandError;
      setError(failure);
      const delay = options.retry ? readRetryDelay(failure, ++failures) : null;
      if (delay !== null) timer = setTimeout(() => void refresh(), delay);
    }
  };
  createEffect(key, () => {
    failures = 0;
    setValue(null);
    setError(null);
    void refresh();
  }, { name: `${options.name}:load` });
  onSettled(() => () => { disposed = true; sequence++; active?.abort(); clearTimeout(timer); });
  return { value, error, refresh };
}
