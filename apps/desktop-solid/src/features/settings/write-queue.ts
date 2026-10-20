/** Coalesces edits in one turn and serializes host read/modify/write commands. */
export class SettingsWriteQueue {
  private queued: Record<string, unknown> = {};
  private active: Record<string, unknown> = {};
  private running?: Promise<void>;
  private wake?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private batchStartedAt = 0;
  private flushRequested = false;
  private draining = 0;
  private failures: unknown[] = [];

  constructor(
    private readonly write: (updates: Record<string, unknown>) => Promise<unknown>,
    private readonly failed: (error: unknown) => void,
    private readonly settled: () => void,
    private readonly intervalMs = 0,
  ) {}

  pending() {
    return { ...this.active, ...this.queued };
  }

  /** Commit the latest batch immediately, e.g. when a slider gesture finishes. */
  flush() {
    clearTimeout(this.timer);
    const wake = this.wake;
    this.wake = undefined;
    if (wake) wake();
    else if (this.running) this.flushRequested = true;
  }

  /** Flush debounce and wait for the queue to settle, reporting this batch's first failure. */
  async drain(): Promise<void> {
    const failures: unknown[] = [];
    this.draining++;
    try {
      while (this.running) {
        const running = this.running;
        const batchFailures = this.failures;
        this.flush();
        await running;
        failures.push(...batchFailures);
      }
      if (failures.length) throw failures[0];
    } finally {
      this.draining--;
    }
  }

  enqueue(field: string, value: unknown) {
    this.queued[field] = value;
    if (this.wake) {
      clearTimeout(this.timer);
      // Trailing debounce, with a bounded delay during a continuous drag.
      const remaining = Math.max(0, this.intervalMs * 5 - (Date.now() - this.batchStartedAt));
      this.timer = setTimeout(() => this.flush(), Math.min(this.intervalMs, remaining));
    }
    if (!this.running) {
      this.failures = [];
      this.running = Promise.resolve().then(async () => {
        try {
          while (Object.keys(this.queued).length) {
            if (this.intervalMs > 0 && !this.flushRequested && !this.draining)
              await new Promise<void>((resolve) => {
                this.batchStartedAt = Date.now();
                this.wake = resolve;
                this.timer = setTimeout(() => this.flush(), this.intervalMs);
              });
            this.flushRequested = false;
            this.active = this.queued;
            this.queued = {};
            try {
              await this.write(this.active);
            } catch (error) {
              this.failures.push(error);
              this.failed(error);
            } finally {
              this.active = {};
            }
          }
        } finally {
          this.flushRequested = false;
          this.running = undefined;
          this.settled();
        }
      });
    }
    return this.running;
  }
}
