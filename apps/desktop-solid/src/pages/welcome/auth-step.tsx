import { Button } from '@vesta/ui';
import { Match, Show, Switch } from 'solid-js';
import { createDeviceCode, DeviceCode, DeviceCodeActions } from '../../features/accounts/device-code';
import { Icon } from '../../components/icon';
import { onboarding, signIn } from '../../features/onboarding';
import { t } from '../../localization';

/**
 * Step 3: Microsoft device-code sign-in, inline. Idle shows one button. Once a code exists the
 * card becomes two numbered moves: copy the code, then paste it on Microsoft's page. One
 * button does both (copies, then opens the page); the code itself also copies on click.
 */
export function AuthStep() {
  const state = () => signIn.state();
  const device = createDeviceCode(() => state().expiresAt, signIn.copyCode, signIn.openPage);
  return (
    <div data-vesta="welcome-auth">
      <header data-vesta="welcome-head" data-align="center">
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
          <DeviceCode code={state().code!} state={device} />
          <div data-vesta="welcome-actions" data-align="center">
            <DeviceCodeActions state={device} retry={() => void signIn.cancel().then(signIn.start)} cancel={() => void signIn.cancel()} />
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
        <Show when={onboarding.guest() || (!onboarding.loginOnly() && state().phase !== 'waiting')}>
          <button type="button" data-vesta="welcome-quiet-link" onClick={() => void onboarding.continueAsGuest()}>
            {t('welcome.explore-guest')}
          </button>
        </Show>
      </footer>
    </div>
  );
}
