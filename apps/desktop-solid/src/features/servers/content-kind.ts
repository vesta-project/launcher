/** Archive-only rule from the instance resource ledger, scoped by content folder. */
export type ContentKind = 'mod' | 'plugin' | 'resource_pack' | 'shader' | 'datapack';
export function contentPathKind(value: string): ContentKind | null {
  const path = value.toLowerCase().replace(/\.disabled$/, '');
  const slash = path.lastIndexOf('/');
  const folder = path.slice(0, slash), name = path.slice(slash + 1);
  if (folder === 'mods' && name.endsWith('.jar')) return 'mod';
  if (folder === 'plugins' && name.endsWith('.jar')) return 'plugin';
  if (folder === 'resourcepacks' && name.endsWith('.zip')) return 'resource_pack';
  if (folder === 'shaderpacks' && name.endsWith('.zip')) return 'shader';
  if ((folder === 'datapacks' || folder.endsWith('/datapacks')) && name.endsWith('.zip')) return 'datapack';
  return null;
}
export const isContentEntry = (entry: { path: string; kind: string }) =>
  contentPathKind(entry.path) === entry.kind || (entry.kind === 'datapack' && !entry.path.split('/').at(-1)?.includes('.'));
