import { Button, Dialog } from '@vesta/ui';
import { Show, createSignal, createEffect } from 'solid-js';
import { open } from '@tauri-apps/plugin-shell';
import { copyText } from '../../platform/clipboard';
import { t } from '../../localization';
import { closeAccountLogin, loginState, startAccountLogin, restoreLoginFocus } from './login';
import './account-menu.css';

export function AccountLoginDialog() {
  const [feedback, setFeedback] = createSignal<'copied' | 'failed' | 'open-failed' | undefined>(undefined, { name: 'loginClipboardFeedback' });
  createEffect(() => loginState().code, () => setFeedback(undefined));
  const copy = async () => {
    const code = loginState().code;
    if (!code) return;
    try { await copyText(code); setFeedback('copied'); }
    catch { setFeedback('failed'); }
  };
  const openSignIn = async () => {
    const url = loginState().url;
    if (!url) return;
    try {
      // Only a trusted Microsoft device-login URL may leave the app.
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(parsed.hostname)) throw new Error('Unexpected sign-in URL');
      await open(parsed.href);
    } catch { setFeedback('open-failed'); }
  };
  return (
    <Dialog
      title={t('account.sign-in')}
      description={t('account.sign-in-description')}
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
          <Button onClick={() => void openSignIn()}>{t('account.open-sign-in')}</Button>
        </Show>
      </>}
    >
      <div data-vesta="account-login">
        <Show when={loginState().phase === 'error'} fallback={
          <Show when={loginState().code} fallback={<p role="status">{t('account.connecting')}</p>}>
            <p>{t('account.enter-code')}</p>
            <button type="button" data-vesta="account-device-code" onClick={() => void copy()} aria-label={t('account.copy-code')}>
              {loginState().code}
            </button>
            <p role="status">{t('account.waiting')}</p>
          </Show>
        }>
          <p role="alert" data-vesta="account-action-error">{loginState().error}</p>
        </Show>
        <Show when={feedback()}>
          <p role="status">{t(feedback() === 'copied' ? 'account.code-copied' : feedback() === 'open-failed' ? 'account.open-failed' : 'account.copy-failed')}</p>
        </Show>
      </div>
    </Dialog>
  );
}
