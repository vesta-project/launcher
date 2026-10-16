import { createEffect } from 'solid-js';
import './styles/base.css';
import './styles/tokens/palette.css';
import './styles/tokens/semantic.css';
import './styles/tokens/brand.css';
import '@vesta/ui';
import { startDesktop } from './platform/desktop';
import { Shell } from './app/shell';
import { initializeLocalization } from './localization';

export default function App() {
  createEffect(() => undefined, () => {
    initializeLocalization();
    return startDesktop();
  });
  return <Shell />;
}
