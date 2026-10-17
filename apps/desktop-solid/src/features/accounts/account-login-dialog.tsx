import { Button, Dialog } from '@vesta/ui';
import { Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { open } from '@tauri-apps/plugin-shell';
import { copyText } from '../../platform/clipboard';
import { t } from '../../localization';
import { Icon } from '../../components/icon';
import { closeAccountLogin, loginState, startAccountLogin, restoreLoginFocus } from './login';
import './account-login.css';

export function AccountLoginDialog() {
  const [feedback, setFeedback] = createSignal<'copied' | 'failed' | 'open-failed' | undefined>(undefined, { name: 'loginClipboardFeedback' });
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(feedbackTimer));
  createEffect(() => loginState().code, () => { clearTimeout(feedbackTimer); setFeedback(undefined); });
  const copy = async () => {
    const code = loginState().code;
    if (!code) return;
    try {
      await copyText(code);
      setFeedback('copied');
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => setFeedback(undefined), 1800);
    }
    catch { setFeedback('failed'); }
  };
  const openSignIn = async () => {
    const url = loginState().url;
    if (!url) return;
    try {
      setFeedback(undefined);
      // Only a trusted Microsoft device-login URL may leave the app.
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(parsed.hostname)) throw new Error('Unexpected sign-in URL');
      await open(parsed.href);
    } catch { setFeedback('open-failed'); }
  };
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
      footer={<>
        <Button variant="ghost" onClick={() => void closeAccountLogin()}>{t('common.cancel')}</Button>
        <Show when={loginState().phase === 'error' && loginState().retryable}>
          <Button onClick={() => { setFeedback(undefined); void startAccountLogin(); }}>{t('common.retry')}</Button>
        </Show>
        <Show when={loginState().code && loginState().phase !== 'error'}>
          <Button tone="accent" iconEnd={<Icon name="icons/actions/external-link" size={14} />} onClick={() => void openSignIn()}>{t('account.open-sign-in')}</Button>
        </Show>
      </>}
    >
      <div data-vesta="account-login">
        <Show when={loginState().phase === 'error'} fallback={
          <Show when={loginState().code} fallback={
            <div data-vesta="account-login-status" role="status">
              <span data-vesta="account-login-spinner" aria-hidden="true" />
              <span>{t('account.connecting')}</span>
            </div>
          }>
            <button type="button" data-vesta="account-device-code" onClick={() => void copy()} aria-label={t('account.copy-code')} data-tip={t('account.copy-code')}>
              <code>{loginState().code}</code>
              <span data-vesta="account-device-code-icon"><Icon name={feedback() === 'copied' ? 'icons/controls/check' : 'icons/actions/copy'} size={16} /></span>
            </button>
            <div data-vesta="account-login-status" role="status">
              <Show when={feedback() === 'copied'} fallback={<span data-vesta="account-login-spinner" aria-hidden="true" />}>
                <Icon name="icons/controls/check" size={14} />
              </Show>
              <span>{t(feedback() === 'copied' ? 'account.code-copied' : 'account.waiting')}</span>
            </div>
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
