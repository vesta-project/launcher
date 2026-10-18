import { createEffect, untrack } from 'solid-js';
import './styles/base.css';
import './styles/tokens/palette.css';
import './styles/tokens/semantic.css';
import './styles/tokens/brand.css';
import '@vesta/ui';
import { startDesktop } from './platform/desktop';
import { Shell } from './app/shell';
import { initializeLocalization } from './localization';

if (import.meta.env.DEV) void import('./features/activity/activity-fixtures');

export default function App() {
  // One-time start-up: its reads are snapshots, never dependencies.
  createEffect(
    () => undefined,
    () =>
      untrack(() => {
        initializeLocalization();
        return startDesktop();
      }),
  );
  return <Shell />;
}
