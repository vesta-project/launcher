import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { preloadLaunchers } from '../launcher-import';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { createSignal, untrack } from 'solid-js';
import { navigate } from '../../app/router';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { createAccountLoginSession, closeAccountLogin } from '../accounts/login';
import { LoginSession, type LoginState } from '../accounts/login-session';
import { openExternal } from '../links/external-links';
import { refreshConfig, setting, updateSetting, flushSettings } from '../settings/config';
import { OnboardingFlow, isAuthenticated, type FlowState, type SetupAccount, type SetupConfig } from './flow';
import { createFirstInstance, prefetchFirstInstance } from './first-instance';
import { fixtureHost, fixtureLogin } from './onboarding-fixtures';
export type { OnboardingStep } from './flow';
export type { FeaturedPack, DetectedLauncher } from './types';

async function localized<T>(work: Promise<T>, message: MessageId): Promise<T> {
  try { return await work; } catch { throw new Error(t(message)); }
}
const native = typeof window !== 'undefined' && isTauri();
const host = native ? {
  config: () => invoke<SetupConfig>('get_config'),
  // Only the public account fields are retained, never tokens or credential payloads.
  account: async (): Promise<SetupAccount | null> => {
    const value = await localized(invoke<SetupAccount | null>('get_active_account'), 'onboarding.auth-error');
    return value ? { account_type: value.account_type, is_expired: value.is_expired } : null;
  },
  persist: (step: number) => localized(invoke<void>('set_setup_step', { step }), 'onboarding.save-error'),
  reset: () => localized(invoke<void>('reset_onboarding'), 'onboarding.save-error'),
  complete: () => localized(invoke<void>('complete_onboarding'), 'onboarding.finish-error'),
  guest: () => invoke<void>('start_guest_session'),
} : fixtureHost;
const [state, setState] = createSignal<FlowState>({ status: 'loading', step: 'splash', direction: 1, loginOnly: false, guest: false }, { name: 'onboardingFlow' });
const [online, setOnline] = createSignal(typeof navigator === 'undefined' || navigator.onLine, { name: 'onboardingOnline' });
interface SignInState {
  phase: 'idle' | 'starting' | 'waiting' | 'error' | 'done';
  code?: string; url?: string; expiresAt?: number; error?: string;
}
const [authState, setAuthState] = createSignal<SignInState>({ phase: 'idle' }, { name: 'onboardingSignIn' });
const flow = new OnboardingFlow({
  ...host,
  cancelLogin: () => signIn.cancel(),
  enter: (path) => navigate(path, { replace: true }),
  prefetch: () => { void prefetchFirstInstance(); },
  authRequired: () => new Error(t('onboarding.auth-required')),
}, setState);
const publishLogin = (value: LoginState) => {
  if (!value.open) { setAuthState({ phase: 'idle' }); return; }
  setAuthState({ phase: value.phase, code: value.code, url: value.url, expiresAt: value.expiresAt,
    error: value.phase === 'error' ? t('onboarding.auth-error') : undefined });
};
const authenticated = () => {
  setAuthState({ phase: 'done' });
  void flow.authenticated().catch(() => setAuthState({ phase: 'error', error: t('onboarding.auth-error') }));
};
let fixture: ReturnType<typeof fixtureLogin> | undefined;
const inlineSession = native ? createAccountLoginSession(publishLogin, authenticated) : new LoginSession({
  listen: async (receive) => { fixture = fixtureLogin(receive); return () => fixture?.stop(); },
  start: async () => { await fixture?.start(); },
  cancel: async () => { fixture?.stop(); },
  complete: authenticated,
}, publishLogin);
export const signIn = {
  state: authState,
  start: async () => {
    if (flow.state.status !== 'active' || flow.state.step !== 'auth') return;
    if (!untrack(online)) { setAuthState({ phase: 'error', error: t('onboarding.offline-error') }); return; }
    await closeAccountLogin();
    await inlineSession.start();
  },
  cancel: async () => { await inlineSession.close(); setAuthState({ phase: 'idle' }); },
  copyCode: async (): Promise<boolean> => {
    const code = untrack(authState).code;
    if (!code) return false;
    try {
      if (native) await writeText(code);
      else await navigator.clipboard.writeText(code);
      return true;
    } catch { return false; }
  },
  openPage: async () => {
    const url = untrack(authState).url;
    if (!url) return;
    try { await openExternal(url); }
    catch { setAuthState((current) => ({ ...current, error: t('onboarding.open-error') })); }
  },
};
const { reset: resetFirstInstance, ...firstInstance } = createFirstInstance({
  authorize: async () => { if (!isAuthenticated(await host.account())) throw new Error(t('onboarding.auth-required')); },
  advance: () => flow.goTo('complete'),
  finish: (path) => flow.finish(path),
});
export { firstInstance };
export const onboarding = {
  status: () => state().status,
  step: () => state().step,
  direction: () => state().direction,
  loginOnly: () => state().loginOnly,
  online,
  next: () => flow.next(), back: () => flow.back(), canGoBack: () => { state(); return flow.canGoBack(); },
  goTo: (step: import('./flow').OnboardingStep) => flow.goTo(step),
  continueAsGuest: async () => {
    try { await flow.continueAsGuest(); }
    catch { throw new Error(t('onboarding.guest-error')); }
  },
  guest: () => state().guest,
  signInFromGuest: () => flow.signInFromGuest(),
  finish: () => flow.finish(),
  telemetry: () => setting('telemetry_enabled'),
  setTelemetry: async (on: boolean) => { updateSetting('telemetry_enabled', on); flushSettings(); },
};
/** Settings can restart the flow in this window; it does not restart the desktop host. */
export async function resetOnboarding() {
  await flow.reset();
  resetFirstInstance();
}
let startup: Promise<void> | undefined;
/** Mount once from App, retaining network listeners for exactly the App lifetime. */
export function startOnboarding(): () => void {
  // Discovery starts independently of pack/config/auth latency.
  void preloadLaunchers().catch(() => {});
  let disposed = false;
  const stops: (() => void)[] = [];
  const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
  const activated = () => {
    void (startup ?? Promise.resolve()).then(() => {
      if (!disposed) return flow.accountActivated();
    }).catch((error) => console.error('Unable to reconcile guest session:', error));
  };
  if (native) {
    void Promise.all([
      listen<{ field: string }>('config-updated', (event) => {
        if (event.payload.field === 'active_account_uuid') activated();
      }).then(retain),
      listen('core://accounts-changed', activated).then(retain),
    ]).catch((error) => console.error('Guest account subscription failed:', error));
  }
  const syncOnline = () => setOnline(navigator.onLine);
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  if (!startup) {
    void refreshConfig();
    startup = flow.initialize(new URLSearchParams(window.location.search).get('login') === 'true').catch((error) => {
      console.error('Unable to initialize onboarding:', error);
      // Fail closed into sign-in; never expose the shell on an uncertain account/config read.
      flow.signInFromGuest();
    });
  }
  return () => {
    disposed = true;
    stops.forEach((stop) => stop());
    window.removeEventListener('online', syncOnline);
    window.removeEventListener('offline', syncOnline);
    void signIn.cancel();
  };
}
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const dev = window as unknown as { vestaDev?: Record<string, unknown> };
  dev.vestaDev = { ...dev.vestaDev, onboarding: resetOnboarding };
}
