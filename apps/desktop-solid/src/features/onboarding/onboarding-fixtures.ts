import type { AuthEvent } from '../accounts/login-session';
import type { FeaturedPack, DetectedLauncher } from './types';
import type { SetupAccount, SetupConfig } from './flow';

// Session-only preview state. Nothing here is written to browser storage.
let account: SetupAccount | null = null;
let config: SetupConfig = { setup_completed: false, setup_step: 0 };
export const fixtureHost = {
  config: async () => ({ ...config }), account: async () => account,
  persist: async (step: number) => { config.setup_step = step; },
  reset: async () => { config = { setup_completed: false, setup_step: 0 }; },
  complete: async () => { config = { setup_completed: true, setup_step: 6 }; },
  guest: async () => { account = { account_type: 'Guest', is_expired: false }; },
};
export function fixtureLogin(receive: (event: AuthEvent) => void) {
  let timer: ReturnType<typeof setTimeout>;
  return {
    start: async () => {
      receive({ stage: 'AuthCode', code: 'VESTA-DEMO', url: 'https://www.microsoft.com/link', expires_in: 900 });
      timer = setTimeout(() => {
        account = { account_type: 'Microsoft', is_expired: false };
        receive({ stage: 'Complete', user_uuid: 'preview', user_username: 'PlayerOne' });
      }, 4000);
    },
    stop: () => clearTimeout(timer),
  };
}
export const fixturePacks: FeaturedPack[] = [
  ['sop', 'Simply Optimized'], ['fabulously-optimized', 'Fabulously Optimized'],
  ['adrenaline', 'Adrenaline'], ['additive', 'Additive'], ['cobblemon', 'Cobblemon'], ['prominence-2-rpg', 'Prominence II RPG'],
].map(([projectId, name]) => ({ projectId, name, source: 'modrinth', author: 'Modrinth community', minecraft: '1.21.1', loader: 'fabric' }));
export const fixtureLaunchers: DetectedLauncher[] = [
  { id: 'prism', label: 'Prism Launcher', instanceCount: 3, icon: 'branding/launchers/prism-launcher' },
  { id: 'modrinthApp', label: 'Modrinth App', instanceCount: 2, icon: 'branding/sources/modrinth' },
];
