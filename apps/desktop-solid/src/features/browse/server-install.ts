// The glue between Browse and a server target, over the server content contract:
//   serverSoftware            -> `server_content` inventory `software`
//   resolveServerDependencies -> `server_content_dependencies` (the shared instance resolver)
//   installToServer           -> `server_content_install`, one durable intent per resource
//   installToModpack          -> one reviewed, atomic pack draft edit
import { fetchProjects } from './browse-api';
import type { ResourceProject, ResourceVersion } from './browse-model';
import { isContentProvider, previewCandidates, type DependencyCandidate, type Destination, type ServerTarget } from './install-targets';
export { isContentProvider, isServerContentKind, previewCandidates, serverInstallPlan, type ServerInstallItem } from './install-targets';
import { invalidateServerResources, readServerResource } from '../servers/resources';
import { CONTENT_RESOURCES, contentResource, softwareResource } from '../servers/server-resources';
import { serverCommand } from '../servers/store';
import type { ConnectionId } from '../servers/native';

/**
 * Managed server software id, or null when it is unidentified or cannot be read. The content
 * inventory reports the authoritative family to anyone who may list content; the owner-only
 * software state is the fallback when the inventory cannot be read.
 */
export async function serverSoftware(id: ConnectionId): Promise<string | null> {
  const inventory = await readServerResource(id, contentResource).catch(() => undefined);
  if (inventory) return inventory.software;
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

/**
 * Server targets: native resolves against the server's authoritative Minecraft version,
 * software and inventory with the same traversal instances use.
 */
export function resolveServerDependencies(target: ServerTarget): DependencyResolver {
  return async ({ project, version }) => {
    const source = project.source;
    // Other sources have no server install path; their declared list is still worth showing.
    if (!isContentProvider(source)) return declaredDependencies({ project, version });
    const preview = await serverCommand((client) => client.contentDependencies(target.id, source, project.id, version.id));
    return previewCandidates(preview);
  };
}

export type { ServerSelection, ServerInstallOutcome } from './server-install-flow';
import type { ServerSelection } from './server-install-flow';
import * as flow from './server-install-flow';

const changed = (id: ConnectionId) => (destination: 'server' | 'modpack') =>
  invalidateServerResources(id, destination === 'server' ? CONTENT_RESOURCES : ['pack-draft', 'pack-suggestions', 'pack-preview']);

export const prepareServerSelection = (target: ServerTarget, project: ResourceProject, versions: readonly ResourceVersion[], destination: Destination) =>
  flow.prepareServerSelection(target, project, versions, destination, serverCommand);
export const installToServer = (target: ServerTarget, selection: ServerSelection) =>
  flow.installToServer(target, selection, serverCommand, changed(target.id));
export const installToModpack = (target: ServerTarget, selection: ServerSelection) =>
  flow.installToModpack(target, selection, serverCommand, changed(target.id));
export const installToServerTarget = (target: ServerTarget, selection: ServerSelection) =>
  flow.installToServerTarget(target, selection, serverCommand, changed(target.id));
