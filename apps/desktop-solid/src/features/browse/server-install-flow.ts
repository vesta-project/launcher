// Reviewed Browse server/pack operations, independent of UI stores and native initialization.
import type { ResourceProject, ResourceType, ResourceVersion } from './browse-model';
import { selectInstallVersion } from './browse-model';
import { dependencyRows, isContentProvider, previewCandidates, serverInstallPlan, serverVersion, type DependencyRow, type Destination, type ServerTarget } from './install-targets';
import type { ServersApi } from '../servers/service';
import type { ServerCommandError } from '../servers/native';
import type { ContentChange } from '../servers/native-content';

export interface ServerSelection {
  project: ResourceProject;
  version: ResourceVersion;
  kind: ResourceType;
  destination: Destination;
  dependencies: readonly DependencyRow[];
  packRevision?: string;
  /** Keep this and the reviewed selection when retrying an uncertain result. */
  intentId?: string;
}

type Command = <T>(run: (api: ServersApi) => Promise<T>) => Promise<T>;

/** Review client dependencies against the draft's runtime, independently of server software. */
export async function prepareServerSelection(target: ServerTarget, project: ResourceProject, versions: readonly ResourceVersion[], destination: Destination, run: Command) {
  if (!isContentProvider(project.source)) return undefined;
  const workspace = destination !== 'server' ? await run(api => api.packDraft(target.id)) : undefined;
  if (workspace?.minecraftDrift) throw { code: 'stale_target' };
  const manifest = workspace?.draft.manifest;
  const candidates = manifest ? versions.filter(version => !!selectInstallVersion([version], {
    minecraftVersion: manifest.minecraftVersion, modloader: manifest.loader === 'none' ? 'vanilla' : manifest.loader,
  }, project.resource_type, project.source)) : versions;
  const version = destination === 'modpack' ? candidates[0] : serverVersion(candidates, target, project.resource_type, project.source);
  if (!version) return undefined;
  const rows: DependencyRow[] = [];
  if (destination !== 'modpack') {
    const preview = await run(api => api.contentDependencies(target.id, project.source as 'modrinth' | 'curseforge', project.id, version.id));
    rows.push(...dependencyRows(previewCandidates(preview)).map(row => ({ ...row, destination: 'server' as const })));
  }
  let packRevision: string | undefined;
  if (workspace) {
    if (!isContentProvider(project.source)) return undefined;
    const preview = await run(api => api.packDependencies(target.id, project.source as 'modrinth' | 'curseforge', project.id, version.id));
    if (preview.target.draft.revision !== workspace.draft.revision || preview.target.minecraftDrift) throw { code: 'stale_target' };
    packRevision = preview.target.draft.revision;
    rows.push(...dependencyRows(previewCandidates(preview)).map(row => ({ ...row, destination: 'modpack' as const })));
  }
  return { version, rows, packRevision, intentId: crypto.randomUUID() };
}

export type ServerInstallOutcome =
  /** `staged`: Minecraft is running, so at least one change applies on its next start or restart. */
  | { kind: 'started'; count: number; staged: boolean; destination?: Destination }
  | { kind: 'partial'; count: number; staged: boolean; message: string; error?: ServerCommandError }
  | { kind: 'unavailable'; reason: 'server-coming' | 'modpack-coming' }
  | { kind: 'failed'; message: string; error?: ServerCommandError; installed?: number };

/** Installs the project and the ticked dependencies into the server's files. */
export async function installToServer(target: ServerTarget, selection: ServerSelection, run: Command, changed?: (destination: 'server' | 'modpack') => void): Promise<ServerInstallOutcome> {
  const plan = serverInstallPlan(selection);
  if (!plan) return { kind: 'unavailable', reason: 'server-coming' };
  const changes: ContentChange[] = [];
  const intent = selection.intentId ?? crypto.randomUUID();
  try {
    // There is no multi-resource transaction; each request is its own durable intent.
    for (const { provider, projectId, versionId, kind } of plan) {
      changes.push(await run((client) => client.contentInstall(target.id, { provider, projectId, versionId, kind }, `${intent}:server:${changes.length}`)));
    }
  } catch (reason) {
    const error = reason as ServerCommandError;
    return { kind: 'failed', message: error.reason ?? error.code, error, installed: changes.length };
  } finally {
    if (changes.length) changed?.('server');
  }
  return { kind: 'started', count: changes.length, staged: changes.some((change) => change.state === 'pending') };
}

/** Adds reviewed provider IDs and choices to the draft without publishing it. */
export async function installToModpack(target: ServerTarget, selection: ServerSelection, run: Command, changed?: (destination: 'server' | 'modpack') => void): Promise<ServerInstallOutcome> {
  if (!isContentProvider(selection.project.source)) return { kind: 'unavailable', reason: 'server-coming' };
  if (!selection.packRevision) return { kind: 'failed', message: 'stale_target', error: { code: 'stale_target' } as ServerCommandError };
  const dependencies = selection.dependencies.filter(row => row.destination !== 'server' && row.selected && !row.installed);
  if (dependencies.some(row => !row.version || !isContentProvider(row.project.source))) return { kind: 'failed', message: 'stale_target' };
  try {
    await run(client => client.packAdd(target.id, {
      expectedRevision: selection.packRevision!, provider: selection.project.source as 'modrinth' | 'curseforge',
      projectId: selection.project.id, versionId: selection.version.id, required: true,
      dependencies: dependencies.map(row => ({ provider: row.project.source as 'modrinth' | 'curseforge', projectId: row.project.id, versionId: row.version!.id, required: row.required })),
    }, `${selection.intentId ?? crypto.randomUUID()}:modpack`));
    changed?.('modpack');
    return { kind: 'started', count: 1 + dependencies.length, staged: false, destination: 'modpack' };
  } catch (reason) {
    const error = reason as ServerCommandError;
    return { kind: 'failed', message: error.reason ?? error.code, error };
  }
}

/** Runs the chosen destination; Both installs on the server first, then adds to the pack. */
export async function installToServerTarget(
  target: ServerTarget,
  selection: ServerSelection,
  run: Command,
  changed?: (destination: 'server' | 'modpack') => void,
): Promise<ServerInstallOutcome> {
  try {
    if (selection.destination === 'modpack') return await installToModpack(target, selection, run, changed);
    if (selection.destination === 'both' && !selection.packRevision) return { kind: 'failed', message: 'stale_target' };
    const server = await installToServer(target, selection, run, changed);
    if (selection.destination === 'server' || server.kind !== 'started') return server;
    const pack = await installToModpack(target, selection, run, changed);
    if (pack.kind !== 'started') return { kind: 'partial', count: server.count, staged: server.staged, message: pack.kind === 'failed' ? pack.message : 'modpack-coming', error: pack.kind === 'failed' ? pack.error : undefined };
    return { kind: 'started', count: server.count + pack.count, staged: server.staged, destination: 'both' };
  } catch (reason) {
    return { kind: 'failed', message: String(reason) };
  }
}
