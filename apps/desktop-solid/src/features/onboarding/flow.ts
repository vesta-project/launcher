/** Host step numbers are persisted by the original launcher; 3 was the Learn guide. */
export const steps = ['splash', 'credits', 'auth', 'theme', 'first-instance', 'complete'] as const;
export type OnboardingStep = typeof steps[number];
export const hostSteps: Record<OnboardingStep, number> = { splash: 0, credits: 1, auth: 2, theme: 4, 'first-instance': 5, complete: 6 };
export interface SetupConfig { setup_completed?: boolean; setup_step?: unknown }
export interface SetupAccount { account_type?: string | null; is_expired?: boolean | null }
export const isGuest = (account: SetupAccount | null | undefined) => /^(guest|demo)$/i.test(account?.account_type?.trim() ?? '');
export const isAuthenticated = (account: SetupAccount | null | undefined) => !!account && !account.is_expired && !isGuest(account);
export function resumeStep(value: unknown): OnboardingStep {
  const numeric = Number(value);
  const step = Number.isFinite(numeric) ? Math.max(0, Math.min(6, Math.trunc(numeric))) : 0;
  return steps.find((name) => hostSteps[name] >= step) ?? 'splash';
}
export function resolveSetup(config: SetupConfig, account: SetupAccount | null, forceLogin = false) {
  const legacy = !!config.setup_completed && hostSteps[resumeStep(config.setup_step)] <= 2;
  const staleGuest = isGuest(account);
  const completed = !!config.setup_completed && !legacy && !staleGuest;
  const authenticated = isAuthenticated(account);
  let step = completed || forceLogin ? 'auth' as const : legacy || staleGuest ? 'splash' as const : resumeStep(config.setup_step);
  if (!completed && !forceLogin) {
    if (step === 'auth' && authenticated) step = 'theme';
    if (hostSteps[step] > 2 && !authenticated) step = 'auth';
  }
  return { status: completed && authenticated && !forceLogin ? 'done' as const : 'active' as const,
    step, loginOnly: completed || forceLogin, completed, reset: legacy || staleGuest };
}
export interface FlowState {
  status: 'loading' | 'active' | 'done'; step: OnboardingStep; direction: 1 | -1; loginOnly: boolean; guest: boolean;
}
interface FlowTransport {
  config(): Promise<SetupConfig>; account(): Promise<SetupAccount | null>;
  persist(step: number): Promise<void>; reset(): Promise<void>; complete(): Promise<void>; guest(): Promise<void>;
  cancelLogin(): Promise<void>; enter(path: string): void; prefetch(): void; authRequired(): Error;
}
/** One owner for completion, authentication guards and serialized persisted navigation. */
export class OnboardingFlow {
  state: FlowState = { status: 'loading', step: 'splash', direction: 1, loginOnly: false, guest: false };
  private completed = false;
  private finishing?: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  constructor(private transport: FlowTransport, private publish: (state: FlowState) => void) {}
  private update(value: Partial<FlowState>) { this.state = { ...this.state, ...value }; this.publish(this.state); }
  private serialize(work: () => Promise<void>) {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
  async initialize(forceLogin = false) {
    const [config, account] = await Promise.all([this.transport.config(), this.transport.account()]);
    const resolved = resolveSetup(config, account, forceLogin);
    if (resolved.reset) await this.transport.reset(); // Host startup owns stale guest account/marker cleanup.
    this.completed = resolved.completed;
    this.update({ status: resolved.status, step: resolved.step, loginOnly: resolved.loginOnly, guest: false });
    if (resolved.status === 'active') {
      if (!resolved.loginOnly) await this.transport.persist(hostSteps[resolved.step]);
      this.transport.prefetch();
    }
  }
  private async move(target: OnboardingStep) {
    if (this.state.status !== 'active') return;
    if (this.state.loginOnly) target = 'auth';
    const backward = hostSteps[target] < hostSteps[this.state.step];
    if (hostSteps[target] >= 2) {
      const authenticated = isAuthenticated(await this.transport.account());
      if (hostSteps[target] > 2 && !authenticated) target = 'auth';
      else if (target === 'auth' && authenticated && !this.state.loginOnly) target = backward ? 'splash' : 'theme';
    }
    if (this.state.step === 'auth' && target !== 'auth') await this.transport.cancelLogin();
    if (!this.state.loginOnly) await this.transport.persist(hostSteps[target]);
    this.update({ step: target, direction: backward ? -1 : 1 });
  }
  goTo(step: OnboardingStep) { return this.serialize(() => this.move(step)); }
  next() { return this.serialize(async () => {
    if (this.state.step === 'auth' && this.state.loginOnly) {
      if (!isAuthenticated(await this.transport.account())) throw this.transport.authRequired();
      if (this.completed) await this.finishNow('/library');
      else { this.update({ loginOnly: false }); await this.move('theme'); }
    } else if (this.state.step === 'complete') await this.finishNow('/library');
    else await this.move(steps[Math.min(steps.length - 1, steps.indexOf(this.state.step) + 1)]);
  }); }
  canGoBack() { return this.state.status === 'active' && !this.state.loginOnly && this.state.step !== 'splash'; }
  back() { return this.serialize(async () => {
    if (!this.canGoBack()) return;
    await this.move(this.state.step === 'auth' ? 'splash' : steps[Math.max(0, steps.indexOf(this.state.step) - 1)]);
  }); }
  continueAsGuest() { return this.serialize(async () => {
    await this.transport.cancelLogin();
    await this.transport.guest();
    this.transport.enter('/library');
    this.update({ status: 'done', guest: true });
  }); }
  signInFromGuest() {
    this.finishing = undefined;
    this.update({ status: 'active', step: 'auth', direction: 1, loginOnly: true });
    this.transport.prefetch();
  }
  authenticated() { return this.serialize(async () => {
    this.update({ guest: false });
    if (this.completed) await this.finishNow('/library');
    else { this.update({ loginOnly: false }); await this.move('theme'); }
  }); }
  private finishNow(path: string): Promise<void> {
    if (this.finishing) return this.finishing;
    this.finishing = (async () => {
      if (!isAuthenticated(await this.transport.account())) throw this.transport.authRequired();
      // Guest re-entry looks login-only, but unfinished setup must still be completed.
      if (!this.completed) { await this.transport.complete(); this.completed = true; }
      this.transport.enter(path);
      this.update({ status: 'done', guest: false });
    })().catch((error) => { this.finishing = undefined; throw error; });
    return this.finishing;
  }
  finish(path = '/library') { return this.serialize(() => this.finishNow(path)); }
  reset() { return this.serialize(async () => {
    await this.transport.cancelLogin();
    await this.transport.reset();
    this.completed = false;
    this.finishing = undefined;
    this.update({ status: 'active', step: 'splash', direction: 1, loginOnly: false });
    this.transport.prefetch();
  }); }
}
