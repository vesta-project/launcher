/** Owns a pending irreversible action independently from its originating view. */
export function deferAction(options: { commit: () => Promise<unknown>; rollback: () => void; onError: (reason: unknown) => void; onCommit: () => void; delay: number }) {
  let pending = true;
  const timer = setTimeout(() => {
    if (!pending) return;
    pending = false;
    options.onCommit();
    void Promise.resolve().then(options.commit).catch(reason => { options.rollback(); options.onError(reason); });
  }, options.delay);
  return () => {
    if (!pending) return;
    pending = false; clearTimeout(timer); options.rollback();
  };
}
