import { Show, createEffect, untrack } from 'solid-js';
import './styles/base.css';
import './styles/tokens/palette.css';
import './styles/tokens/semantic.css';
import './styles/tokens/brand.css';
import '@vesta/ui';
import { startDesktop } from './platform/desktop';
import { Shell } from './app/shell';
import { initializeLocalization } from './localization';
import { onboarding, startOnboarding } from './features/onboarding';
import { WelcomePage } from './pages/welcome/welcome-page';

if (import.meta.env.DEV) void import('./features/activity/activity-fixtures');

export default function App() {
  // One-time start-up: its reads are snapshots, never dependencies.
  createEffect(
    () => undefined,
    () =>
      untrack(() => {
        initializeLocalization();
        const stopDesktop = startDesktop();
        const stopOnboarding = startOnboarding();
        return () => { stopOnboarding(); stopDesktop(); };
      }),
  );
  return (
    <Show when={onboarding.status() !== 'loading'} fallback={<div style={{ position: 'fixed', inset: '0', background: 'var(--vesta-color-canvas)' }} />}>
      <Show when={onboarding.status() === 'active'} fallback={<Shell />}><WelcomePage /></Show>
    </Show>
  );
}
