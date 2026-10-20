export type AuthEvent =
  | { stage: 'Start' | 'Polling' | 'Cancelled' }
  | { stage: 'AuthCode'; code: string; url: string; expires_in: number }
  | { stage: 'Complete'; user_uuid: string; user_username: string }
  | { stage: 'Error'; code: string; message: string; retryable: boolean; service?: string };

export interface LoginState {
  open: boolean;
  phase: 'starting' | 'waiting' | 'error';
  code?: string;
  url?: string;
  error?: string;
  retryable?: boolean;
  expiresAt?: number;
}

interface LoginTransport {
  listen: (receive: (event: AuthEvent) => void) => Promise<() => void>;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  complete: () => void;
}

/** Owns one native device-code session. Attach events before invoking start_login.
 * Closing retires callbacks; a slow start must settle/cancel before another may start.
 */
export class LoginSession {
  private state: LoginState = { open: false, phase: 'starting' };
  private stop?: () => void;
  private generation = 0;
  private pending = false;
  private cancelling = false;
  private nativeStarted = false;

  constructor(private transport: LoginTransport, private publish: (state: LoginState) => void) {}

  private release() {
    const stop = this.stop;
    this.stop = undefined;
    stop?.();
  }

  private update(next: Partial<LoginState>) {
    this.state = { ...this.state, ...next };
    this.publish(this.state);
  }

  async start(): Promise<void> {
    if (this.pending || this.cancelling || (this.state.open && this.state.phase !== 'error')) return;
    const generation = ++this.generation;
    this.pending = true;
    this.nativeStarted = false;
    this.release();
    this.state = { open: true, phase: 'starting' };
    this.publish(this.state);
    try {
      const stop = await this.transport.listen((event) => {
        if (generation !== this.generation) return;
        switch (event.stage) {
          case 'Start': break;
          case 'AuthCode': this.update({ code: event.code, url: event.url, expiresAt: Date.now() + event.expires_in * 1000, phase: 'waiting' }); break;
          case 'Polling': this.update({ phase: 'waiting' }); break; // retain device code
          case 'Complete':
            ++this.generation;
            this.nativeStarted = false;
            this.update({ open: false });
            this.release();
            this.transport.complete();
            break;
          case 'Cancelled': this.update({ open: false }); this.release(); break;
          case 'Error':
            this.update({ phase: 'error', error: event.message, retryable: event.retryable });
            this.release();
            break;
        }
      });
      if (generation !== this.generation) { stop(); return; }
      this.stop = stop;
      this.nativeStarted = true;
      await this.transport.start();
      // cancel_login can race the request for a device code. Cancel again once start
      // has installed its polling task; a newer session is excluded by pending.
      if (generation !== this.generation && this.nativeStarted) await this.transport.cancel();
    } catch (error) {
      if (generation === this.generation) {
        this.update({ phase: 'error', error: error instanceof Error ? error.message : String(error), retryable: true });
        this.release();
      }
    } finally {
      this.pending = false;
    }
  }

  async close(): Promise<void> {
    ++this.generation;
    this.update({ open: false });
    this.release();
    this.stop = undefined;
    if (!this.nativeStarted || this.cancelling) return;
    this.cancelling = true;
    try { await this.transport.cancel(); }
    catch (error) { console.error('Unable to cancel Microsoft sign-in:', error); }
    finally { this.cancelling = false; }
  }
}
