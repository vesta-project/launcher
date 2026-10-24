/** Raw Minecraft documents require confirmation; private paths are never exposed. */
export type FileProtection = 'normal' | 'confirm_edit' | 'hidden';
export const rawProtectedFile = (path: string) => ['server.properties', 'whitelist.json', 'ops.json', 'banned-players.json', 'banned-ips.json'].includes(path.toLowerCase());
export function fileProtection(path: string): FileProtection {
  if (path.split('/').some(p => ['.vesta', '.git', '.hg', '.svn', 'wrapper-config.toml', 'vesta-wrapper', 'start-vesta-wrapper.sh', 'start-vesta-wrapper.bat'].includes(p.toLowerCase()))) return 'hidden';
  return rawProtectedFile(path) ? 'confirm_edit' : 'normal';
}
