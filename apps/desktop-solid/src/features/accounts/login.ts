import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createSignal } from 'solid-js';
import { LoginSession, type AuthEvent, type LoginState } from './login-session';

const [loginState, setLoginState] = createSignal<LoginState>({ open: false, phase: 'starting' }, { name: 'accountLogin' });
const session = new LoginSession({
  listen: async (receive) => {
    if (!isTauri()) throw new Error('Microsoft sign-in is available in the desktop app.');
    return listen<AuthEvent>('vesta://auth', (event) => receive(event.payload));
  },
  start: () => invoke('start_login'),
  cancel: () => invoke('cancel_login'),
  complete: () => window.dispatchEvent(new Event('vesta:account-login-complete')),
}, setLoginState);

export { loginState };
let focusOrigin: HTMLElement | undefined;
export function startAccountLogin() {
  if (!loginState().open && typeof document !== 'undefined') {
    focusOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  }
  return session.start();
}
export function restoreLoginFocus() {
  const target = focusOrigin?.isConnected && focusOrigin !== document.body ? focusOrigin
    : [...document.querySelectorAll<HTMLElement>('[data-vesta="profile-button"]')].find((button) => button.getBoundingClientRect().width > 0);
  target?.focus();
}
export const closeAccountLogin = () => session.close();
