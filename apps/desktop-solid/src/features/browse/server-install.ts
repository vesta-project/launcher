// The glue between Browse and a server target. Every call the server content contract will
// replace lives here, so connecting it is one function each:
//   serverSoftware          -> `server_content` inventory `software` (today: `server_software`)
//   resolveServerDependencies -> `server_content_dependencies`
//   installToServer          -> `server_content_install`
//   installToModpack         -> the stage 2 pack draft
import { fetchProjects } from './browse-api';
import type { ResourceProject, ResourceVersion } from './browse-model';
import type { DependencyCandidate, DependencyRow, Destination, ServerTarget, TargetKind } from './install-targets';
import { readServerResource } from '../servers/resources';
import { softwareResource } from '../servers/server-resources';
import type { ConnectionId } from '../servers/native';

/** Managed server software id, or null when it is unidentified or cannot be read. */
export async function serverSoftware(id: ConnectionId): Promise<string | null> {
  // TODO(server-content): prefer `ServerContentInventory.software` from `server_content`.
  const state = await readServerResource(id, softwareResource).catch(() => undefined);
  return state?.current?.software ?? null;
}

export interface DependencyRequest {
  project: ResourceProject;
  version: ResourceVersion;
}

export type DependencyResolver = (request: DependencyRequest) => Promise<DependencyCandidate[]>;

/**
 * Required and optional dependencies the version itself declares, named from the provider.
 * Instances resolve their dependencies inside `install_resource`, so this is only a preview.
 */
export async function declaredDependencies({ project, version }: DependencyRequest): Promise<DependencyCandidate[]> {
  const wanted = (version.dependencies ?? []).filter(
    (dependency) =>
      (dependency.dependency_type === 'required' || dependency.dependency_type === 'optional') &&
      dependency.project_id !== project.id,
  );
  if (!wanted.length) return [];
  const found = await fetchProjects(
    project.source,
    wanted.map((dependency) => dependency.project_id),
  ).catch(() => [] as ResourceProject[]);
  const byId = new Map(found.map((item) => [item.id, item]));
  return wanted.flatMap((dependency) => {
    const known = byId.get(dependency.project_id);
    if (!known && !dependency.project_id) return [];
    return [
      {
        project: known
          ? { id: known.id, name: known.name, source: known.source, icon_url: known.icon_url }
          : { id: dependency.project_id, name: dependency.file_name || dependency.project_id, source: project.source },
        version: null,
        required: dependency.dependency_type === 'required',
      },
    ];
  });
}

/** Instance targets: the same preview; the host resolves the real set while installing. */
export const resolveInstanceDependencies: DependencyResolver = declaredDependencies;

/** Server targets: resolved against the server's Minecraft version, software and inventory. */
export function resolveServerDependencies(target: ServerTarget): DependencyResolver {
  // TODO(server-content): call `server_content_dependencies` (serversContentNative.contentDependencies
  // with target.id, project.source, project.id, version.id) and map
  // `ServerDependency { project, version, required, installed }` straight to DependencyCandidate.
  void target;
  return declaredDependencies;
}

export interface ServerSelection {
  project: ResourceProject;
  version: ResourceVersion;
  kind: TargetKind;
  destination: Destination;
  dependencies: readonly DependencyRow[];
}

export type ServerInstallOutcome =
  | { kind: 'started'; count: number }
  | { kind: 'unavailable'; reason: 'server-coming' | 'modpack-coming' }
  | { kind: 'failed'; message: string };

/** Installs the project and the ticked dependencies into the server's files. */
export async function installToServer(target: ServerTarget, selection: ServerSelection): Promise<ServerInstallOutcome> {
  // TODO(server-content): for the project and each selected dependency, call `server_content_install`
  // (serversContentNative.contentInstall(target.id, { provider, projectId, versionId, kind }, newIntentId())).
  // Dependency rows without a resolved version need the resolver above to supply one first.
  void target;
  void selection;
  return { kind: 'unavailable', reason: 'server-coming' };
}

/** Adds the project to the client modpack draft. Comes with the pack workspace (stage 2). */
export async function installToModpack(target: ServerTarget, selection: ServerSelection): Promise<ServerInstallOutcome> {
  void target;
  void selection;
  return { kind: 'unavailable', reason: 'modpack-coming' };
}

/** Runs the chosen destination; Both installs on the server first, then adds to the pack. */
export async function installToServerTarget(
  target: ServerTarget,
  selection: ServerSelection,
): Promise<ServerInstallOutcome> {
  try {
    if (selection.destination === 'modpack') return await installToModpack(target, selection);
    const server = await installToServer(target, selection);
    if (selection.destination === 'server' || server.kind !== 'started') return server;
    return await installToModpack(target, selection);
  } catch (reason) {
    return { kind: 'failed', message: String(reason) };
  }
}
