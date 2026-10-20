import { Show } from 'solid-js';
import { Icon } from '../../components/icon';
import { onboarding } from '../../features/onboarding';
import { t } from '../../localization';

/**
 * While someone explores without an account: a quiet reminder at the end of the titlebar
 * that doubles as the way back to Microsoft sign-in (and the rest of setup).
 */
export function GuestChip() {
  return (
    <Show when={onboarding.guest()}>
      <button
        type="button"
        data-vesta="titlebar-guest"
        aria-label={`${t('welcome.guest-label')}. ${t('welcome.guest-sign-in')}`}
        onClick={() => onboarding.signInFromGuest()}
      >
        <span data-vesta="titlebar-guest-label">{t('welcome.guest-label')}</span>
        <span data-vesta="titlebar-guest-action">
          <Icon name="branding/microsoft" size={11} />
          {t('welcome.guest-sign-in')}
        </span>
      </button>
    </Show>
  );
}
