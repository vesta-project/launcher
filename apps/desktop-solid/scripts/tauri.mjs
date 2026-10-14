import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [command, ...extraArgs] = process.argv.slice(2);

if (command !== 'dev' && command !== 'build') {
  console.error('Usage: bun scripts/tauri.mjs <dev|build> [tauri arguments]');
  process.exit(2);
}

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriArgs = [
  'run',
  `--cwd=${appRoot}`,
  'tauri',
  command,
  ...extraArgs,
];

const env = {
  ...process.env,
  CARGO_TARGET_DIR: path.join(appRoot, '.tauri-target'),
};

if (command === 'dev' || (command === 'build' && extraArgs.includes('--debug'))) {
  env.VESTA_DEV_PROFILE_DIR ??= path.join(appRoot, '.dev-profile');
}

const result = spawnSync('bun', tauriArgs, {
  cwd: appRoot,
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
