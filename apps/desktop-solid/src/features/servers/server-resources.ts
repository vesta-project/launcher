// The cached reads the server workspace shares between tabs, prefetch and the shell.
import { toServerError } from './errors';
import { readServerResource, serverResource } from './resources';
import { keepMinecraft, softwareVersionKind } from './software-flow';
import { loadOperations, serverCommand } from './store';
import type { BackupOverview, BackupStorage } from './native-manage';
import type { SoftwareId } from './hosting-native';
import { historyRequest, type GraphRange } from './metrics-model';

/** Recent tasks; the operations topic keeps the store current after the first read. */
export const operationsResource = serverResource('operations', (id) => loadOperations(id));
export const operationHistoryResource = serverResource('operation-history', (id, cursor: string) =>
  serverCommand((client) => client.operations(id, cursor)));

export const whitelistResource = serverResource('whitelist', (id) => serverCommand((client) => client.whitelist(id)));
export const operatorsResource = serverResource('operators', (id) => serverCommand((client) => client.operators(id)));
export const bansResource = serverResource('bans', (id) => serverCommand((client) => client.bans(id)));

const NO_BACKUPS: BackupOverview = { profiles: [], jobs: [], nextBefore: null, recoveryRequired: false };

/** Backup profiles and recent jobs. A server without backups reads as an empty overview. */
export const backupsResource = serverResource('backups', async (id): Promise<BackupOverview> => {
  try { return await serverCommand((client) => client.backups(id, null)); }
  catch (reason) {
    if (toServerError(reason).code === 'backups_not_configured') return NO_BACKUPS;
    throw reason;
  }
});

/** Repository usage; optional, so a failure reads as unknown rather than an error. */
export const backupStorageResource = serverResource('backup-storage', (id): Promise<BackupStorage | null> =>
  serverCommand((client) => client.backupStorage(id, true)).catch(() => null));

/** The editable profile set, revision and repository location (owners and administrators). */
export const backupConfigResource = serverResource('backup-config', (id) => serverCommand((client) => client.backupConfiguration(id)));

/** Expanded restore points share the normal refresh and invalidation lifecycle. */
export const backupSnapshotsResource = serverResource('backup-snapshots', (id, profile: string) =>
  serverCommand((client) => client.backupSnapshots(id, profile)));

/** Every player list; moderation operations change them, so they revalidate together when one settles. */
export const PLAYER_LIST_RESOURCES = ['whitelist', 'operators', 'bans'] as const;

// Settings sections. Each is read once per connection and reused while fresh; saves seed
// the cache with the server's reply so the next visit shows it without a read.
export const brandingResource = serverResource('branding', (id) => serverCommand((client) => client.branding(id)));
export const propertiesResource = serverResource('properties', (id) => serverCommand((client) => client.propertiesGet(id)));
export const sleepPolicyResource = serverResource('sleep-policy', (id) => serverCommand((client) => client.sleepPolicy(id)));
export const motdPolicyResource = serverResource('motd-policy', (id) => serverCommand((client) => client.motdPolicy(id)));
export const usersResource = serverResource('users', async (id) => (await serverCommand((client) => client.users(id, 0))).users);
export const rolesResource = serverResource('roles', (id) => serverCommand((client) => client.roles(id)));
export const invitationsResource = serverResource('invitations', (id) => serverCommand((client) => client.invitations(id)));
export const devicesResource = serverResource('devices', (id) => serverCommand((client) => client.devices(id)));
export const accessSourcesResource = serverResource('access-sources', (id) => serverCommand((client) => client.accessSources(id)));

// World, software and SFTP: owner hosting sections, read when their pane opens.
export const worldResource = serverResource('world', (id) => serverCommand((client) => client.world(id)));
export const softwareResource = serverResource('software', (id) => serverCommand((client) => client.software(id)));
export const softwareJobsResource = serverResource('software-jobs', (id) => serverCommand((client) => client.softwareJobs(id)));
/** Java runtimes on the agent host and the one this server uses (owner only). */
export const javaInventoryResource = serverResource('java', (id) => serverCommand((client) => client.javaInventory(id)));
/** Slow-changing upstream lists share five minutes of freshness, including hover warmups. */
const CATALOGUE_FRESH_MS = 5 * 60_000;
export const softwareReleasesResource = serverResource('software-releases', (id, args: { software: SoftwareId; version: string }) =>
  serverCommand((client) => client.softwareReleases(id, args.software, args.version)), CATALOGUE_FRESH_MS);
export const softwareVersionsResource = serverResource('software-versions', (id, software: SoftwareId) =>
  serverCommand((client) => client.softwareVersions(id, software)), CATALOGUE_FRESH_MS);

/** Warm only the intended provider and likely version, sharing reads with the mounted view. */
const warmingCatalogues = new Set<string>();
export async function warmSoftwareMetadata(id: string, software: SoftwareId, wanted: string | null) {
  // Moving across several tiles must not fan out upstream requests or fill the
  // agent's single metadata query slot with speculative work.
  if (warmingCatalogues.has(id)) return;
  warmingCatalogues.add(id);
  try {
    const catalogue = await readServerResource(id, softwareVersionsResource, software);
    const version = keepMinecraft(catalogue.versions, wanted);
    if (version && softwareVersionKind(software)) await readServerResource(id, softwareReleasesResource, { software, version });
  } catch { /* The visible resource owns errors and retry guidance. */ }
  finally { warmingCatalogues.delete(id); }
}
/** Live server content (mods, plugins, datapacks) with staged changes. Listing does no provider IO. */
export const contentResource = serverResource('content', (id) => serverCommand((client) => client.content(id)));
/** What a content mutation can change: the inventory, and the world's datapack state. */
export const CONTENT_RESOURCES = ['content', 'world'] as const;
/**
 * The pack workspace (server modpack link + client pack), shared so Resources can mark the
 * rows the server modpack owns. Needs `pack.edit`; the Modpack area seeds it on every read.
 */
export const packWorkspaceResource = serverResource('pack-workspace', (id) => serverCommand((client) => client.packDraft(id)));
export const sftpResource = serverResource('sftp', (id) => serverCommand((client) => client.sftp(id)));
export const sftpKeysResource = serverResource('sftp-keys', (id) => serverCommand((client) => client.sftpKeys(id)));

/**
 * Server-side metrics history for one Overview range (D9). Every read asks for the whole
 * window, so a retention gap or a mutable five-minute bucket is replaced on the next read;
 * live samples extend it in between.
 */
export const metricsHistoryResource = serverResource('metrics-history', (id, range: GraphRange) =>
  serverCommand((client) => client.metricsHistory(id, historyRequest(range, Date.now()))));
