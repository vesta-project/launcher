import { Button, Switch } from '@vesta/ui';
import { For, Show, createSignal, onSettled } from 'solid-js';
import { Icon } from '../../components/icon';
import { openExternal } from '../../features/links/external-links';
import { firstInstance, onboarding } from '../../features/onboarding';
import { t } from '../../localization';

const PRIVACY_POLICY_URL = 'https://github.com/vesta-project/launcher/blob/main/docs/legal/PRIVACY_POLICY.md';

/** Step 1: the name, one line, and the way in. Guests can look around without signing in. */
export function SplashStep() {
  return (
    <div data-vesta="welcome-splash">
      <h1 data-vesta="welcome-wordmark">Vesta</h1>
      <p data-vesta="welcome-tagline">{t('welcome.tagline')}</p>
      <div data-vesta="welcome-splash-actions">
        <Button
          size="lg"
          tone="accent"
          class="welcome-start"
          disabled={!onboarding.online()}
          onClick={() => void onboarding.next()}
        >
          {onboarding.online() ? t('welcome.start') : t('welcome.offline-start')}
        </Button>
        <Show when={!onboarding.online()}>
          <p data-vesta="welcome-offline-hint">{t('welcome.offline-hint')}</p>
        </Show>
        <button type="button" data-vesta="welcome-quiet-link" onClick={() => void onboarding.continueAsGuest()}>
          {t('welcome.explore-guest')}
        </button>
      </div>
    </div>
  );
}

const credits = [
  { name: 'Modrinth', icon: 'branding/sources/modrinth', color: '#1bd96a' },
  { name: 'CurseForge', icon: 'branding/sources/curseforge', color: '#f16436' },
  { name: 'Fabric', icon: 'branding/modloaders/fabric-colored' },
  { name: 'Forge', icon: 'branding/modloaders/forge-colored' },
  { name: 'NeoForge', icon: 'branding/modloaders/neoforge-colored' },
  { name: 'Quilt', icon: 'branding/modloaders/quilt-colored' },
];

/**
 * Step 2, kept as it was: a short thank-you to the community. It moves on by itself after
 * six seconds, or on any key or click (click is armed a beat late, so the Start click that
 * brought us here does not skip it).
 */
export function CreditsStep() {
  const [armed, setArmed] = createSignal(false);
  onSettled(() => {
    const advance = setTimeout(() => void onboarding.next(), 6000);
    const arm = setTimeout(() => setArmed(true), 50);
    const key = (event: KeyboardEvent) => {
      if (event.repeat) return;
      void onboarding.next();
    };
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(advance);
      clearTimeout(arm);
      window.removeEventListener('keydown', key);
    };
  });

  return (
    <div data-vesta="welcome-credits" onClick={() => armed() && void onboarding.next()}>
      <p data-vesta="welcome-credits-text">{t('welcome.credits-text')}</p>
      <p data-vesta="welcome-credits-subtext">{t('welcome.credits-subtext')}</p>
      <ul data-vesta="welcome-credits-logos">
        <For each={credits}>
          {(credit) => (
            <li data-vesta="welcome-credit" style={credit.color ? { color: credit.color } : undefined}>
              <Icon name={credit.icon} size={28} />
              <span data-vesta="welcome-credit-name">{credit.name}</span>
            </li>
          )}
        </For>
      </ul>
      <p data-vesta="welcome-credits-hint">{t('welcome.credits-hint')}</p>
    </div>
  );
}

/** Last step: a short "you're set", naming whatever started installing, then into the app. */
export function CompleteStep() {
  const chosen = () => firstInstance.chosen();
  onSettled(() => {
    const timer = setTimeout(() => void onboarding.finish(), chosen() ? 7000 : 4000);
    return () => clearTimeout(timer);
  });
  return (
    <div data-vesta="welcome-complete">
      <span data-vesta="welcome-complete-mark" aria-hidden="true">
        <Icon name="icons/controls/check" size={30} />
      </span>
      <h2 data-vesta="welcome-title">{t('welcome.complete-title')}</h2>
      <p data-vesta="welcome-lead">{t('welcome.complete-lead')}</p>
      <Show when={chosen()}>
        {(item) => (
          <p data-vesta="welcome-complete-note">
            <Show when={item().iconUrl}>
              {(src) => <img data-vesta="welcome-complete-icon" src={src()} alt="" />}
            </Show>
            <span>
              {item().kind === 'import'
                ? t('welcome.complete-import', { name: item().name })
                : t('welcome.complete-installing', { name: item().name })}
            </span>
          </p>
        )}
      </Show>
      <Button tone="accent" class="welcome-enter" onClick={() => void onboarding.finish()}>
        {t('welcome.enter')}
      </Button>
    </div>
  );
}

/** Shown under the splash only, as before: crash and error reports, with the policy link. */
export function TelemetryToggle() {
  return (
    <div data-vesta="welcome-telemetry">
      <Switch
        checked={onboarding.telemetry()}
        onChange={(on) => void onboarding.setTelemetry(on)}
        aria-label={t('welcome.telemetry')}
      />
      <p data-vesta="welcome-telemetry-text">
        {t('welcome.telemetry')}{' '}
        <a
          href={PRIVACY_POLICY_URL}
          onClick={(event) => {
            event.preventDefault();
            void openExternal(PRIVACY_POLICY_URL);
          }}
        >
          {t('welcome.privacy-policy')}
        </a>
      </p>
    </div>
  );
}
