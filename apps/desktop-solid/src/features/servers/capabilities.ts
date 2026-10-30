// Capability gating for the server UI. This is a presentation hint only; the server
// authorizes every request. Built-in role defaults mirror the agent's
// `vesta-control/src/identity/builtin_roles.rs` at server commit 28d9ba81.
import type { CapabilityView } from './native';

const VIEWER = ['status.view', 'status.detailed', 'metrics.view', 'players.view', 'activity.view', 'tasks.view'];
const OPERATIONS = [
  ...VIEWER, 'diagnostics.view', 'logs.read', 'console.read', 'console.write',
  'lifecycle.start', 'lifecycle.stop', 'lifecycle.restart', 'lifecycle.force_kill', 'maintenance.toggle',
  'files.list', 'files.read', 'files.create', 'files.overwrite', 'files.rename', 'files.mkdir', 'files.delete',
  'content.install', 'backups.view', 'backups.create', 'backups.verify', 'schedules.view', 'schedules.edit', 'schedules.run',
];
const ADMINISTRATOR = [
  ...OPERATIONS, 'players.moderate', 'players.operator', 'config.view', 'config.edit', 'integrations.edit',
  'public.info', 'pack.download', 'pack.realtime', 'pack.access', 'pack.edit', 'pack.build', 'pack.publish', 'pack.force_update',
  'roles.manage', 'access-sources.manage', 'invitations.create', 'automation.view', 'automation.manage', 'notifications.view',
  'principals.view', 'principals.manage', 'devices.revoke', 'roles.create', 'roles.assign', 'roles.revoke',
  'credentials.manage', 'security.manage', 'audit.view', 'backups.configure',
];

export const builtinRoleCapabilities: Record<string, readonly string[]> = {
  owner: [...ADMINISTRATOR, 'backups.restore', 'recovery.export'],
  administrator: ADMINISTRATOR,
  maintainer: OPERATIONS,
  moderator: ['notifications.view', 'status.view', 'players.view', 'players.moderate'],
  viewer: VIEWER,
  'pack-user': ['status.view', 'public.info', 'pack.download', 'pack.realtime', 'pack.access'],
};

/** Canonical role id for the names the agent returns (`admin` is an alias). */
export const roleKey = (role: string | null | undefined) => {
  const value = (role ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return value === 'admin' ? 'administrator' : value;
};

export const capabilitiesForRole = (role: string | null | undefined): string[] | undefined => {
  const known = builtinRoleCapabilities[roleKey(role)];
  return known ? [...known] : undefined;
};

/**
 * `allowed`: show and enable. `denied`: the server refused it or the reported set excludes it; hide.
 * `unknown`: show, and let the server decide (the first refusal turns it into `denied`).
 */
export type Gate = 'allowed' | 'denied' | 'unknown';

export function gate(view: CapabilityView | undefined, capability: string): Gate {
  if (!view) return 'unknown';
  if (view.refused.includes(capability)) return 'denied';
  if (view.granted.includes(capability)) return 'allowed';
  return view.source === 'unknown' ? 'unknown' : 'denied';
}

/** Whole-pack installation is reserved for effective owners/administrators. */
export function canInstallServerModpack(view: CapabilityView | undefined, pairedRole?: string | null): boolean {
  const roles = view?.roles ?? [roleKey(pairedRole)];
  return roles.some(role => ['owner', 'administrator'].includes(roleKey(role)))
    && gate(view, 'content.install') === 'allowed' && gate(view, 'pack.edit') === 'allowed';
}

/** True when any listed capability could be usable. Used to decide whether a tab is shown. */
export const anyVisible = (view: CapabilityView | undefined, capabilities: readonly string[]) =>
  capabilities.some((capability) => gate(view, capability) !== 'denied');
