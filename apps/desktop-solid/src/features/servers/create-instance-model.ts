import type { ServerCommandError, ServerSnapshot } from './native';
/** Absence of an offered pack permits a normal client; other failures must remain visible. */
export function serverInstanceFallback(error: ServerCommandError, snapshot: ServerSnapshot | undefined) {
  if (!['pack_not_published', 'pack_artifact_not_published'].includes(error.reason ?? '') || !snapshot?.info?.minecraftVersion) return null;
  return { name: snapshot.connection.name, minecraft: snapshot.info.minecraftVersion, loader: 'vanilla' };
}
