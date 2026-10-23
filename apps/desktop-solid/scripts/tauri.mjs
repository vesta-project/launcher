import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function tauriInvocation(args, inherited = process.env) {
  const [command, ...extraArgs] = args;
  if (!command) throw new Error('Usage: bun run tauri <command> [tauri arguments]');
  const env = { ...inherited, CARGO_TARGET_DIR: path.join(appRoot, '.tauri-target') };
  if (command === 'dev' || (command === 'build' && extraArgs.includes('--debug'))) {
    env.VESTA_DEV_PROFILE_DIR ??= path.join(appRoot, '.dev-profile');
  }
  // Invoke the installed CLI directly. Calling `bun run tauri` here would
  // recurse now that both public command spellings use this wrapper.
  return { executable: process.execPath, args: [path.join(appRoot, 'node_modules/@tauri-apps/cli/tauri.js'), command, ...extraArgs], options: { cwd: appRoot, env, stdio: 'inherit' } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let invocation;
  try { invocation = tauriInvocation(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exit(2); }
  const result = spawnSync(invocation.executable, invocation.args, invocation.options);
  if (result.error) { console.error(result.error.message); process.exit(1); }
  process.exit(result.status ?? 1);
}
