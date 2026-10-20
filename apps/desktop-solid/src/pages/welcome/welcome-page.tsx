import { TooltipHints } from '@vesta/ui';
import { For, Match, Show, Switch, createMemo } from 'solid-js';
import { detectPlatform } from '../../app/platform';
import { WindowControls } from '../../app/titlebar';
import { ExternalLinkDialog } from '../../features/links/external-link-dialog';
import { onboarding, type OnboardingStep } from '../../features/onboarding';
import { t } from '../../localization';
import { Atmosphere } from './atmosphere';
import { AuthStep } from './auth-step';
import { FirstInstanceStep } from './first-instance-step';
import { CompleteStep, CreditsStep, SplashStep, TelemetryToggle } from './intro-steps';
import { ThemeStep } from './theme-step';
import './welcome.css';

const platform = detectPlatform();

/** The steps that count towards "where am I" (the intro and the farewell do not). */
const counted: OnboardingStep[] = ['auth', 'theme', 'first-instance'];
const stepLabels = {
  auth: 'welcome.progress-auth',
  theme: 'welcome.progress-theme',
  'first-instance': 'welcome.progress-first-instance',
} as const;

/**
 * First run: one card over a slowly drifting backdrop, a step at a time. The titlebar is
 * only a drag strip (plus window controls off macOS); there is no rail or breadcrumb yet.
 */
export function WelcomePage() {
  const position = createMemo(() => counted.indexOf(onboarding.step()), { name: 'welcomePosition' });
  // The intro keeps its full atmosphere; once a theme is chosen the backdrop calms down.
  const calm = () => ['theme', 'first-instance', 'complete'].includes(onboarding.step());

  return (
    <div data-vesta="welcome" data-step={onboarding.step()} data-tauri-drag-region="deep">
      <Atmosphere calm={calm()} />
      <header data-vesta="welcome-bar" data-platform={platform}>
        <Show when={platform === 'windows' || platform === 'linux'}>
          <WindowControls />
        </Show>
      </header>

      <main data-vesta="welcome-stage">
        <section data-vesta="welcome-card" data-step={onboarding.step()}>
          <Show when={position() >= 0 && !onboarding.loginOnly()}>
            <ol
              data-vesta="welcome-progress"
              aria-label={t('welcome.progress')}
              style={{ '--welcome-progress-count': String(counted.length) }}
            >
              <For each={counted}>
                {(step, index) => (
                  <li
                    data-vesta="welcome-progress-step"
                    data-state={index() < position() ? 'done' : index() === position() ? 'current' : undefined}
                    aria-current={index() === position() ? 'step' : undefined}
                  >
                    <span data-vesta="welcome-progress-label">{t(stepLabels[step as keyof typeof stepLabels])}</span>
                  </li>
                )}
              </For>
            </ol>
          </Show>
          <Show when={onboarding.step()} keyed>
            {(step) => (
              <div data-vesta="welcome-step" data-direction={onboarding.direction() > 0 ? 'forward' : 'back'}>
                <Switch>
                  <Match when={step === 'splash'}>
                    <SplashStep />
                  </Match>
                  <Match when={step === 'credits'}>
                    <CreditsStep />
                  </Match>
                  <Match when={step === 'auth'}>
                    <AuthStep />
                  </Match>
                  <Match when={step === 'theme'}>
                    <ThemeStep />
                  </Match>
                  <Match when={step === 'first-instance'}>
                    <FirstInstanceStep />
                  </Match>
                  <Match when={step === 'complete'}>
                    <CompleteStep />
                  </Match>
                </Switch>
              </div>
            )}
          </Show>
        </section>
      </main>

      <Show when={onboarding.step() === 'splash'}>
        <TelemetryToggle />
      </Show>
      <ExternalLinkDialog />
      <TooltipHints />
    </div>
  );
}
