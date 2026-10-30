// Pure decisions for the server workspace shell: which tabs and settings sections exist,
// how old URLs map onto them, when a pane needs a live agent, which errors the header
// already explains, and the one notice the header strip shows.
import type { MessageId } from '../../localization/messages';
import { backupsTabVisible } from './backup-setup-model';
import { anyVisible, gate, roleKey } from './capabilities';
import { connectionFact, lifecycleControls, readinessReasonMessage, supervisorWarnings } from './model';
import { modpackPath, modpackSection } from './modpack-area-model';
import type { ServerErrorCode, ServerSnapshot } from './native';

export type MainTabId = 'overview' | 'console' | 'resources' | 'pack' | 'files' | 'automation' | 'backups' | 'activity';
export type SettingsSectionId = 'general' | 'game' | 'world' | 'software' | 'sftp' | 'presence' | 'players' | 'access' | 'connection';
export type SettingsGroupId = 'server' | 'people' | 'device';

export interface ShellTab<Id extends string = string> {
  id: Id;
  label: MessageId;
  icon: string;
  /** Shown unless every listed capability is known to be absent. Empty means always. */
  needs: readonly string[];
  /** Reads from the agent, so it shows the offline placeholder while the agent can't be reached. */
  live: boolean;
}

export interface ShellSection extends ShellTab<SettingsSectionId> {
  group: SettingsGroupId;
  /** Owner-reserved on the agent: hidden once the caller's role is known to be another. */
  owner?: boolean;
}

export const mainTabs: readonly ShellTab<MainTabId>[] = [
  { id: 'overview', label: 'servers.tab.overview', icon: 'icons/navigation/home', needs: [], live: false },
  { id: 'console', label: 'servers.tab.console', icon: 'icons/content/terminal', needs: ['console.read'], live: true },
  { id: 'resources', label: 'server-content.tab', icon: 'icons/content/layers', needs: ['files.list'], live: true },
  { id: 'pack', label: 'server-pack.title', icon: 'icons/content/modpack', needs: ['pack.edit', 'pack.download', 'pack.access'], live: true },
  { id: 'files', label: 'server-files.tab', icon: 'icons/content/folder', needs: ['files.list'], live: true },
  { id: 'automation', label: 'servers.tab.automation', icon: 'icons/content/timer', needs: ['automation.view'], live: true },
  { id: 'backups', label: 'servers.tab.backups', icon: 'icons/content/storage', needs: ['backups.view', 'backups.configure'], live: true },
  { id: 'activity', label: 'servers.tab.activity', icon: 'icons/content/history', needs: ['tasks.view'], live: true },
];

const ACCESS_NEEDS = ['principals.view', 'invitations.create', 'devices.revoke', 'access-sources.manage'];

export const settingsSections: readonly ShellSection[] = [
  { id: 'general', group: 'server', label: 'servers.settings.general', icon: 'icons/content/gear', needs: ['config.view'], live: true },
  { id: 'game', group: 'server', label: 'servers.settings.game', icon: 'icons/content/sliders', needs: ['config.view'], live: true },
  { id: 'world', group: 'server', label: 'server-hosting.world', icon: 'icons/content/globe', needs: ['config.view'], live: true },
  { id: 'software', group: 'server', label: 'server-hosting.software', icon: 'icons/content/cube', needs: ['content.install'], live: true, owner: true },
  { id: 'sftp', group: 'server', label: 'server-hosting.sftp', icon: 'icons/security/folder-lock', needs: ['config.view'], live: true },
  { id: 'presence', group: 'server', label: 'servers.tab.presence', icon: 'icons/status/live', needs: ['config.view'], live: true },
  { id: 'players', group: 'people', label: 'servers.tab.players', icon: 'icons/content/people', needs: ['players.view'], live: true },
  { id: 'access', group: 'people', label: 'servers.tab.access', icon: 'icons/security/shield', needs: ACCESS_NEEDS, live: true },
  { id: 'connection', group: 'device', label: 'servers.tab.connection', icon: 'icons/security/network', needs: [], live: false },
];

export const settingsGroups: readonly { id: SettingsGroupId; label: MessageId }[] = [
  { id: 'server', label: 'servers.settings.group-server' },
  { id: 'people', label: 'servers.settings.group-people' },
  { id: 'device', label: 'servers.settings.group-device' },
];

/** Tab ids from before settings mode, and where each now lives. */
export const legacyTabs: Readonly<Record<string, SettingsSectionId>> = {
  players: 'players',
  presence: 'presence',
  access: 'access',
  connection: 'connection',
  settings: 'game',
};

export type ServerLocation =
  | { mode: 'main'; tab: MainTabId }
  | { mode: 'settings'; section: SettingsSectionId };

const isMainTab = (value: string | undefined): value is MainTabId => mainTabs.some((tab) => tab.id === value);
const isSection = (value: string | undefined): value is SettingsSectionId => settingsSections.some((section) => section.id === value);

/**
 * Where `/servers/<id>/<detail>/<item>` points. `redirect` is set when the URL is an old
 * or partial form that should be replaced with the canonical one.
 */
export function resolveServerLocation(detail: string | undefined, item: string | undefined): ServerLocation & { redirect?: string } {
  if (detail === 'settings') {
    if (isSection(item)) return { mode: 'settings', section: item };
    // `/settings` alone used to be the server.properties tab.
    return { mode: 'settings', section: item ? 'general' : 'game', redirect: `settings/${item ? 'general' : 'game'}` };
  }
  if (detail && legacyTabs[detail]) {
    const section = legacyTabs[detail]!;
    return { mode: 'settings', section, redirect: `settings/${section}` };
  }
  if (isMainTab(detail)) return { mode: 'main', tab: detail };
  return { mode: 'main', tab: 'overview' };
}

/** The path for a tab or settings section of a server. */
export function serverPath(id: string, location: ServerLocation): string {
  if (location.mode === 'settings') return `/servers/${id}/settings/${location.section}`;
  return location.tab === 'overview' ? `/servers/${id}` : `/servers/${id}/${location.tab}`;
}

/** Whether the server has at least one backup profile; undefined while unknown. */
export type BackupsConfigured = boolean | undefined;

export interface VisibleTabsInput {
  snapshot: Pick<ServerSnapshot, 'capabilities'>;
  /** undefined while unknown (not loaded yet). */
  backupsConfigured: BackupsConfigured;
  /** The tab in the URL, kept visible while its availability is still being learned. */
  requested?: string;
}

export function visibleMainTabs(input: VisibleTabsInput): ShellTab<MainTabId>[] {
  return mainTabs.filter((tab) => {
    if (tab.needs.length && !anyVisible(input.snapshot.capabilities, tab.needs)) return false;
    // Shown once set up, or while this user could set it up (owners and administrators).
    if (tab.id === 'backups') return backupsTabVisible(input.backupsConfigured, gate(input.snapshot.capabilities, 'backups.configure') !== 'denied', input.requested === 'backups');
    return true;
  });
}

/**
 * One sidebar entry. For pack editors the Modpack tab becomes two entries in a "Modpack" group
 * at the end of the list, Server modpack (`/pack`) and Client pack (`/pack/client` and its
 * sections); everyone else keeps the single Modpack entry in place. `value` identifies the entry.
 */
export interface ServerNavEntry { value: string; tab: ShellTab<MainTabId>; label: MessageId; icon: string; group?: 'modpack' }

export const CLIENT_PACK_ENTRY = 'pack/client';

export function serverNavEntries(tabs: readonly ShellTab<MainTabId>[], editsPack: boolean): ServerNavEntry[] {
  const pack = editsPack ? tabs.find((tab) => tab.id === 'pack') : undefined;
  const flat = tabs.filter((tab) => tab !== pack).map((tab): ServerNavEntry => ({ value: tab.id, tab, label: tab.label, icon: tab.icon }));
  if (!pack) return flat;
  return [
    ...flat,
    { value: 'pack', tab: pack, label: 'server-pack.section-server', icon: 'icons/content/server', group: 'modpack' },
    { value: CLIENT_PACK_ENTRY, tab: pack, label: 'server-pack.section-client', icon: 'icons/content/modpack', group: 'modpack' },
  ];
}

/** The selected entry for a main tab and the URL's item segment. */
export function activeNavEntry(tab: MainTabId, item: string | undefined, editsPack: boolean): string {
  return tab === 'pack' && editsPack && modpackSection(item) === 'client' ? CLIENT_PACK_ENTRY : tab;
}

/** Where a sidebar entry leads. */
export function navEntryPath(id: string, value: string): string {
  return value === CLIENT_PACK_ENTRY ? modpackPath(id, 'overview') : serverPath(id, { mode: 'main', tab: value as MainTabId });
}

export function visibleSections(snapshot: Pick<ServerSnapshot, 'capabilities'> & { connection?: { role: string | null } }): ShellSection[] {
  const role = snapshot.connection?.role;
  return settingsSections.filter((section) =>
    (!section.needs.length || anyVisible(snapshot.capabilities, section.needs))
    && !(section.owner && role && roleKey(role) !== 'owner'));
}

/** The agent can be asked for data right now. */
export const agentReachable = (snapshot: Pick<ServerSnapshot, 'state'>) =>
  snapshot.state.phase === 'online' && snapshot.state.access === 'paired';

/** What a pane shows: its content, or the one offline placeholder. */
export function paneState(snapshot: Pick<ServerSnapshot, 'state'>, tab: Pick<ShellTab, 'live'>): 'ready' | 'offline' {
  return tab.live && !agentReachable(snapshot) ? 'offline' : 'ready';
}

/** Transport and capacity failures: retried quietly, explained once by the header strip. */
const QUIET: ReadonlySet<ServerErrorCode> = new Set(['unreachable', 'timeout', 'server_busy', 'rate_limited', 'outcome_unknown']);
export const isQuietError = (code: ServerErrorCode | undefined | null) => !!code && QUIET.has(code);

export interface Pressure {
  code: 'server_busy' | 'rate_limited';
  untilMs: number;
}

/**
 * Whether a panel should keep an error to itself. Quiet errors are hidden while the header
 * explains them (the connection is down, or the server asked us to slow down); real,
 * actionable errors always show where they happened.
 */
export function headerExplains(error: { code: ServerErrorCode; reason?: string | null } | null | undefined, snapshot: Pick<ServerSnapshot, 'state'>, pressure: Pressure | null, nowMs: number): boolean {
  if (error?.reason?.startsWith('content_') || error?.reason?.startsWith('pack_')) return false;
  if (!error || !isQuietError(error.code)) return false;
  if (snapshot.state.phase !== 'online') return true;
  if (snapshot.state.rateLimitedUntilMs && snapshot.state.rateLimitedUntilMs > nowMs) return true;
  return !!pressure && pressure.untilMs > nowMs;
}

export type NoticeKind = 'crash-loop' | 'recovery' | 'connection' | 'pressure' | 'degraded' | 'limited' | 'restart';

export interface HeaderNotice {
  kind: NoticeKind;
  tone: 'danger' | 'warning' | 'neutral';
  title: { message: MessageId; args?: Record<string, string | number> };
  text?: { message: MessageId; args?: Record<string, string | number> };
  /** Inline action the strip offers. */
  action?: 'retry' | 'restart';
}

/**
 * The single most important thing to say under the header, in priority order:
 * Minecraft can't run, the agent can't be reached, the server asked us to slow down,
 * Minecraft is degraded, control is limited, then a pending restart.
 */
export function headerNotice(snapshot: ServerSnapshot, nowMs: number, pressure: Pressure | null = null): HeaderNotice | null {
  const status = snapshot.status;
  const online = snapshot.state.phase === 'online';
  if (online && (status?.lifecycle === 'crash_loop' || status?.supervisor?.crashLoop)) {
    return { kind: 'crash-loop', tone: 'danger', title: { message: 'servers.minecraft.crash-loop' }, text: { message: 'servers.notice.crash-loop' } };
  }
  if (online && status?.lifecycle === 'recovery_required') {
    return { kind: 'recovery', tone: 'danger', title: { message: 'servers.minecraft.recovery-required' }, text: { message: 'servers.notice.recovery' } };
  }
  if (!online) {
    const fact = connectionFact(snapshot, nowMs);
    return {
      kind: 'connection',
      tone: snapshot.state.phase === 'connecting' ? 'neutral' : 'warning',
      title: { message: fact.message, args: fact.args },
      text: { message: status ? 'servers.notice.last-known' : 'servers.notice.no-state' },
      action: snapshot.state.phase === 'connecting' ? undefined : 'retry',
    };
  }
  const limitedUntil = Math.max(snapshot.state.rateLimitedUntilMs ?? 0, pressure?.untilMs ?? 0);
  if (limitedUntil > nowMs) {
    const busy = pressure?.code === 'server_busy' && !(snapshot.state.rateLimitedUntilMs && snapshot.state.rateLimitedUntilMs > nowMs);
    return {
      kind: 'pressure',
      tone: 'neutral',
      title: { message: busy ? 'servers.error.server-busy' : 'servers.error.rate-limited' },
      text: { message: 'servers.notice.pressure' },
    };
  }
  if (status?.readinessReason) {
    return { kind: 'degraded', tone: 'warning', title: { message: 'servers.minecraft.degraded' }, text: { message: readinessReasonMessage[status.readinessReason] } };
  }
  const warnings = supervisorWarnings(status ?? null);
  if (warnings.length) return { kind: 'limited', tone: 'warning', title: { message: 'servers.notice.limited-control' }, text: { message: warnings[0]! } };
  if (restartPending(snapshot)) {
    return {
      kind: 'restart',
      tone: 'neutral',
      title: { message: 'servers.notice.restart-title' },
      text: { message: 'servers.notice.restart' },
      action: lifecycleControls(snapshot).restart ? 'restart' : undefined,
    };
  }
  return null;
}

/** Settings wait for a restart only while Minecraft runs; a stopped server applies them on its next start. */
export const restartPending = (snapshot: Pick<ServerSnapshot, 'restartRequired' | 'status'>) =>
  snapshot.restartRequired && !!snapshot.status && snapshot.status.state !== 'stopped';

/** Supervisor warnings the header strip isn't already showing. */
export function extraWarnings(snapshot: ServerSnapshot, notice: HeaderNotice | null): MessageId[] {
  const warnings = supervisorWarnings(snapshot.status);
  if (notice?.kind === 'limited') return warnings.slice(1);
  return warnings;
}

/** Player count for the header: only when the server observed it for the running game. */
export function knownPlayerCount(snapshot: Pick<ServerSnapshot, 'status' | 'state'>): number | null {
  const status = snapshot.status;
  if (snapshot.state.phase !== 'online' || status?.state !== 'running' || !status.playerCountKnown) return null;
  return status.playerCount;
}

/**
 * The address players type into Minecraft, when the server reports one. Never the
 * agent endpoint: that is only how this device manages the server.
 */
export function joinAddress(snapshot: ServerSnapshot): string | null {
  const value = (snapshot as ServerSnapshot & { joinAddress?: string | null; gameAddress?: string | null }).joinAddress
    ?? (snapshot as ServerSnapshot & { gameAddress?: string | null }).gameAddress;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Whether the server has backups set up: the snapshot's flag when the agent sends one,
 * otherwise the number of profiles in the last backups overview (undefined until loaded).
 */
export function backupsConfigured(snapshot: ServerSnapshot, overview: { profiles: readonly unknown[] } | null | undefined): BackupsConfigured {
  if (gate(snapshot.capabilities, 'backups.view') === 'denied') return false;
  const flag = (snapshot as ServerSnapshot & { backupsConfigured?: boolean | null }).backupsConfigured;
  if (typeof flag === 'boolean') return flag;
  if (!overview) return undefined;
  return overview.profiles.length > 0;
}
