import { Button, Dialog, Skeleton } from '@vesta/ui';
import { For, Show, createSignal, createEffect } from 'solid-js';
import { open } from '@tauri-apps/plugin-shell';
import { copyText } from '../../platform/clipboard';
import { t } from '../../localization';
import { Icon } from '../../components/icon';
import { closeAccountLogin, loginState, startAccountLogin, restoreLoginFocus } from './login';
import { createDeviceCode, DeviceCode, DeviceCodeActions } from './device-code';
import './account-login.css';

export function AccountLoginDialog() {
  const [feedback, setFeedback] = createSignal<'failed' | 'open-failed' | undefined>(undefined, { name: 'loginClipboardFeedback' });
  createEffect(() => loginState().code, () => setFeedback(undefined));
  const copy = async () => {
    const code = loginState().code;
    if (!code) return false;
    try { await copyText(code); return true; }
    catch { setFeedback('failed'); return false; }
  };
  const openSignIn = async () => {
    const url = loginState().url;
    if (!url) return;
    try {
      setFeedback((state) => state === 'open-failed' ? undefined : state);
      // Only a trusted Microsoft device-login URL may leave the app.
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(parsed.hostname)) throw new Error('Unexpected sign-in URL');
      await open(parsed.href);
    } catch { setFeedback('open-failed'); }
  };
  const waiting = () => loginState().phase === 'waiting' && loginState().code;
  const device = createDeviceCode(() => waiting() ? loginState().expiresAt : undefined, copy, openSignIn);
  return (
    <Dialog
      title={t('account.sign-in')}
      description={t(loginState().code && loginState().phase !== 'error' ? 'account.enter-code' : 'account.sign-in-description')}
      class="account-login-dialog"
      open={loginState().open}
      onOpenChange={(value) => { if (!value) { setFeedback(undefined); void closeAccountLogin(); } }}
      onCloseAutoFocus={(event) => { event.preventDefault(); restoreLoginFocus(); }}
      closeLabel={t('nav.close')}
      size="sm"
      footer={
        <Show when={waiting()} fallback={
          <>
            <Button variant="ghost" onClick={() => void closeAccountLogin()}>{t('common.cancel')}</Button>
            <Show when={loginState().phase === 'error' && loginState().retryable}>
              <Button onClick={() => { setFeedback(undefined); void startAccountLogin(); }}>{t('common.retry')}</Button>
            </Show>
          </>
        }>
          <DeviceCodeActions state={device} cancel={() => void closeAccountLogin()} retry={() => void closeAccountLogin().then(startAccountLogin)} />
        </Show>
      }
    >
      <div data-vesta="account-login">
        <Show when={loginState().phase === 'error'} fallback={
          <Show when={loginState().code} fallback={
            <div data-vesta="account-login-loading" role="status">
              <div data-vesta="account-login-tiles" aria-hidden="true">
                <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>{() => <Skeleton height={46} />}</For>
              </div>
              <div data-vesta="account-login-status">
                <span data-vesta="account-login-spinner" aria-hidden="true" />
                <span>{t('account.connecting')}</span>
              </div>
            </div>
          }>
            <DeviceCode code={loginState().code!} state={device} />
          </Show>
        }>
          <div role="alert" data-vesta="account-login-error">
            <Icon name="icons/status/error" size={18} />
            <p>{loginState().error}</p>
          </div>
        </Show>
        <Show when={feedback() === 'failed' || feedback() === 'open-failed'}>
          <p data-vesta="account-login-feedback" role="alert">
            {t(feedback() === 'open-failed' ? 'account.open-failed' : 'account.copy-failed')}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}
