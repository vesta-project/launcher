import { Button } from '@vesta/ui';
import { Match, Show, Switch, createMemo, createSignal, onSettled } from 'solid-js';
import { Icon } from '../../components/icon';
import { onboarding, signIn } from '../../features/onboarding';
import { t } from '../../localization';

/** "14:52", from the code's expiry; ticks once a second while a code is shown. */
function useCountdown(expiresAt: () => number | undefined) {
  const [now, setNow] = createSignal(Date.now(), { name: 'welcomeAuthClock' });
  onSettled(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  });
  return createMemo(
    () => {
      const end = expiresAt();
      if (end === undefined) return undefined;
      const left = Math.max(0, Math.round((end - now()) / 1000));
      return { left, text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
    },
    { name: 'welcomeAuthCountdown' },
  );
}

/**
 * Step 3: Microsoft device-code sign-in, inline. Idle shows one button. Once a code exists the
 * card becomes two numbered moves: copy the code, then paste it on Microsoft's page. One
 * button does both (copies, then opens the page); the code itself also copies on click.
 */
export function AuthStep() {
  const state = () => signIn.state();
  const [copied, setCopied] = createSignal(false, { name: 'welcomeCodeCopied' });
  const countdown = useCountdown(() => state().expiresAt);
  const expired = () => countdown()?.left === 0;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const copy = async () => {
    if (!(await signIn.copyCode())) return;
    setCopied(true);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(false), 2000);
  };
  const copyAndOpen = async () => {
    await copy();
    await signIn.openPage();
  };

  return (
    <div data-vesta="welcome-auth">
      <header data-vesta="welcome-head">
        <h2 data-vesta="welcome-title">{t('welcome.auth-title')}</h2>
        <p data-vesta="welcome-lead">{t('welcome.auth-lead')}</p>
      </header>

      <Switch>
        <Match when={!onboarding.online()}>
          <div data-vesta="welcome-auth-offline">
            <Icon name="icons/status/connection-lost" size={28} />
            <strong>{t('welcome.auth-offline-title')}</strong>
            <p>{t('welcome.auth-offline-text')}</p>
          </div>
        </Match>

        <Match when={state().phase === 'waiting' && state().code}>
          <div data-vesta="welcome-auth-code">
            <ol data-vesta="welcome-auth-moves">
              <li data-vesta="welcome-auth-move">
                <span data-vesta="welcome-auth-move-number">1</span>
                <span data-vesta="welcome-auth-move-text">{t('welcome.auth-move-copy')}</span>
              </li>
              <li data-vesta="welcome-auth-move">
                <span data-vesta="welcome-auth-move-number">2</span>
                <span data-vesta="welcome-auth-move-text">
                  {t('welcome.auth-move-paste')} <strong>microsoft.com/link</strong>
                </span>
              </li>
            </ol>

            <button
              type="button"
              data-vesta="welcome-code"
              data-expired={expired() ? '' : undefined}
              data-copied={copied() ? '' : undefined}
              aria-label={t('welcome.auth-copy-code', { code: state().code! })}
              disabled={expired()}
              onClick={() => void copy()}
            >
              <span data-vesta="welcome-code-value">{state().code}</span>
              <span data-vesta="welcome-code-hint">
                <Icon name={copied() ? 'icons/controls/check' : 'icons/actions/copy'} size={12} />
                {copied() ? t('welcome.auth-copied') : t('welcome.auth-copy')}
              </span>
            </button>

            <Show
              when={!expired()}
              fallback={
                <div data-vesta="welcome-actions" data-align="center">
                  <Button tone="accent" onClick={() => void signIn.start()}>
                    {t('welcome.auth-new-code')}
                  </Button>
                  <Button variant="ghost" onClick={() => void signIn.cancel()}>
                    {t('common.cancel')}
                  </Button>
                </div>
              }
            >
              <div data-vesta="welcome-actions" data-align="center">
                <Button
                  tone="accent"
                  icon={<Icon name="icons/actions/external-link" size={14} />}
                  onClick={() => void copyAndOpen()}
                >
                  {t('welcome.auth-copy-open')}
                </Button>
                <Button variant="ghost" onClick={() => void signIn.cancel()}>
                  {t('common.cancel')}
                </Button>
              </div>
            </Show>

            <p data-vesta="welcome-auth-waiting" aria-live="polite">
              <Show
                when={!expired()}
                fallback={<span>{t('welcome.auth-expired')}</span>}
              >
                <span data-vesta="welcome-spinner" aria-hidden="true" />
                <span>{t('welcome.auth-waiting')}</span>
                <Show when={countdown()}>
                  {(time) => (
                    <span data-vesta="welcome-auth-timer" data-low={time().left < 30 ? '' : undefined}>
                      {t('welcome.auth-expires', { time: time().text })}
                    </span>
                  )}
                </Show>
              </Show>
            </p>
          </div>
        </Match>

        <Match when={true}>
          <div data-vesta="welcome-auth-idle">
            <Button
              size="lg"
              variant="outline"
              class="welcome-microsoft"
              disabled={state().phase === 'starting'}
              icon={<Icon name="branding/microsoft" size={18} />}
              onClick={() => void signIn.start()}
            >
              {state().phase === 'starting' ? t('welcome.auth-connecting') : t('welcome.auth-microsoft')}
            </Button>
            <Show when={state().phase === 'error' && state().error}>
              {(message) => (
                <p data-vesta="welcome-error" role="alert">
                  <Icon name="icons/status/error" size={13} />
                  <span>{message()}</span>
                </p>
              )}
            </Show>
          </div>
        </Match>
      </Switch>

      <footer data-vesta="welcome-foot">
        <Show when={onboarding.canGoBack() && !onboarding.loginOnly()}>
          <Button variant="ghost" onClick={() => void onboarding.back()}>
            {t('common.back')}
          </Button>
        </Show>
        <span data-vesta="welcome-foot-spacer" />
        <Show when={!onboarding.loginOnly() && state().phase !== 'waiting'}>
          <button type="button" data-vesta="welcome-quiet-link" onClick={() => void onboarding.continueAsGuest()}>
            {t('welcome.explore-guest')}
          </button>
        </Show>
      </footer>
    </div>
  );
}
