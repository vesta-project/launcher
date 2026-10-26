// The glue between Browse and a server target, over the server content contract:
//   serverSoftware            -> `server_content` inventory `software`
//   resolveServerDependencies -> `server_content_dependencies` (the shared instance resolver)
//   installToServer           -> `server_content_install`, one durable intent per resource
//   installToModpack          -> the stage 2 pack draft
import { fetchProjects } from './browse-api';
import type { ResourceProject, ResourceType, ResourceVersion } from './browse-model';
import type { DependencyCandidate, DependencyRow, Destination, ServerTarget } from './install-targets';
import { invalidateServerResources, readServerResource } from '../servers/resources';
import { CONTENT_RESOURCES, contentResource, softwareResource } from '../servers/server-resources';
import { newIntentId } from '../servers/model';
import { serverCommand } from '../servers/store';
import type { ConnectionId, ServerCommandError } from '../servers/native';
import type { ContentChange, ContentProvider, ServerContentKind, ServerDependencyPreview } from '../servers/native-content';

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

const PROVIDERS: readonly string[] = ['modrinth', 'curseforge'];
export const isContentProvider = (source: string): source is ContentProvider['provider'] => PROVIDERS.includes(source);
const SERVER_KINDS: readonly ResourceType[] = ['mod', 'plugin', 'datapack'];
export const isServerContentKind = (kind: ResourceType): kind is ServerContentKind => SERVER_KINDS.includes(kind);

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

/** The shared resolver's rows, as the install dialog shows them. */
export function previewCandidates(preview: Pick<ServerDependencyPreview, 'dependencies'>): DependencyCandidate[] {
  return preview.dependencies.map((dependency) => ({
    project: {
      id: dependency.project.id,
      name: dependency.project.name,
      source: dependency.project.source,
      icon_url: dependency.project.icon_url,
    },
    version: { id: dependency.version.id, version_number: dependency.version.version_number },
    required: dependency.required,
    installed: dependency.installed,
  }));
}

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

export interface ServerSelection {
  project: ResourceProject;
  version: ResourceVersion;
  kind: ResourceType;
  destination: Destination;
  dependencies: readonly DependencyRow[];
}

export type ServerInstallOutcome =
  /** `staged`: Minecraft is running, so at least one change applies on its next start or restart. */
  | { kind: 'started'; count: number; staged: boolean }
  | { kind: 'unavailable'; reason: 'server-coming' | 'modpack-coming' }
  | { kind: 'failed'; message: string; error?: ServerCommandError; installed?: number };

export interface ServerInstallItem extends ContentProvider {
  kind: ServerContentKind;
  name: string;
}

/**
 * What `installToServer` sends: the ticked, not yet installed dependencies first (so the root
 * finds them on its first start), then the project. Rows without an exact version are skipped;
 * the agent installs by provider version only. Null when the server cannot take this kind.
 */
export function serverInstallPlan(selection: Pick<ServerSelection, 'project' | 'version' | 'kind' | 'dependencies'>): ServerInstallItem[] | null {
  const { project, version, kind } = selection;
  const source = project.source;
  if (!isServerContentKind(kind) || !isContentProvider(source)) return null;
  const dependencies = selection.dependencies.flatMap((row): ServerInstallItem[] => {
    const provider = row.project.source;
    return row.selected && !row.installed && row.version && isContentProvider(provider)
      ? [{ provider, projectId: row.project.id, versionId: row.version.id, kind, name: row.project.name }]
      : [];
  });
  return [...dependencies, { provider: source, projectId: project.id, versionId: version.id, kind, name: project.name }];
}

/** Installs the project and the ticked dependencies into the server's files. */
export async function installToServer(target: ServerTarget, selection: ServerSelection): Promise<ServerInstallOutcome> {
  const plan = serverInstallPlan(selection);
  if (!plan) return { kind: 'unavailable', reason: 'server-coming' };
  const changes: ContentChange[] = [];
  try {
    // There is no multi-resource transaction; each request is its own durable intent.
    for (const { provider, projectId, versionId, kind } of plan) {
      changes.push(await serverCommand((client) => client.contentInstall(target.id, { provider, projectId, versionId, kind }, newIntentId())));
    }
  } catch (reason) {
    const error = reason as ServerCommandError;
    return { kind: 'failed', message: error.reason ?? error.code, error, installed: changes.length };
  } finally {
    if (changes.length) invalidateServerResources(target.id, CONTENT_RESOURCES);
  }
  return { kind: 'started', count: changes.length, staged: changes.some((change) => change.state === 'pending') };
}

/** Adds the project to the client modpack draft. Comes with the pack workspace (stage 2). */
export async function installToModpack(target: ServerTarget, selection: ServerSelection): Promise<ServerInstallOutcome> {
  // TODO(server-content): stage 2 pack draft.
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
    // The server half landed; the pack half explains itself until stage 2.
    const pack = await installToModpack(target, selection);
    return pack.kind === 'unavailable' ? server : pack;
  } catch (reason) {
    return { kind: 'failed', message: String(reason) };
  }
}
