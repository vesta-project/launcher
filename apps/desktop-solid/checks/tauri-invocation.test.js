import { expect, test } from 'bun:test';
import { tauriInvocation } from '../scripts/tauri.mjs';

test('all documented Tauri commands use the installed CLI directly with one dev profile/output', () => {
  const dev = tauriInvocation(['dev', '--no-watch'], {});
  expect(dev.args[0].replaceAll('\\', '/')).toEndWith('/node_modules/@tauri-apps/cli/tauri.js');
  expect(dev.args.slice(1)).toEqual(['dev', '--no-watch']);
  expect(dev.args).not.toContain('run');
  expect(dev.options.env.CARGO_TARGET_DIR.replaceAll('\\', '/')).toEndWith('/apps/desktop-solid/.tauri-target');
  expect(dev.options.env.VESTA_DEV_PROFILE_DIR.replaceAll('\\', '/')).toEndWith('/apps/desktop-solid/.dev-profile');
  expect(tauriInvocation(['dev'], { VESTA_DEV_PROFILE_DIR: 'owned-profile' }).options.env.VESTA_DEV_PROFILE_DIR).toBe('owned-profile');
  expect(tauriInvocation(['build'], {}).options.env.VESTA_DEV_PROFILE_DIR).toBeUndefined();
  expect(tauriInvocation(['build', '--debug'], {}).options.env.VESTA_DEV_PROFILE_DIR).toBe(dev.options.env.VESTA_DEV_PROFILE_DIR);
  expect(tauriInvocation(['--version'], {}).args.at(-1)).toBe('--version');
});
