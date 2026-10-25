// Access grouping (D7): people with management roles first, each with their own devices
// nested under them; pack users (who only download the pack through Vesta) folded into one
// group. Plain Minecraft players are never recorded, so they never appear here.
import { roleKey } from './capabilities';
import type { ServerDevice, ServerUser } from './native-manage';

/** Roles that don't manage the server: pack downloads and public/player access. */
const NON_MANAGEMENT = new Set(['pack-user', 'player', 'public']);

/** Any role outside the pack/player/public set manages something, including custom roles. */
export const isManagement = (user: Pick<ServerUser, 'roles'>) => user.roles.some((entry) => !NON_MANAGEMENT.has(roleKey(entry.role.id)));

export interface AccessPerson {
  /** The user id, or `device-owner:<name>` for devices whose user isn't in the list. */
  key: string;
  user: ServerUser | null;
  name: string;
  devices: ServerDevice[];
  /** A device of this person is the one this launcher uses. */
  self: boolean;
}

export interface AccessGroups {
  people: AccessPerson[];
  packUsers: AccessPerson[];
  /** Devices whose user the list doesn't include (no principals.view, or an older agent). */
  others: AccessPerson[];
}

/** This launcher's device first, then active before revoked, then most recently seen, then by name. */
export function sortDevices(devices: readonly ServerDevice[]): ServerDevice[] {
  return devices.toSorted((a, b) => Number(b.current) - Number(a.current) || Number(a.revoked) - Number(b.revoked)
    || (b.lastSeenAtMs ?? 0) - (a.lastSeenAtMs ?? 0) || a.name.localeCompare(b.name));
}

export function groupAccess(users: readonly ServerUser[] | undefined, devices: readonly ServerDevice[] | undefined): AccessGroups {
  const byUser = new Map<string, ServerDevice[]>();
  const loose: ServerDevice[] = [];
  const known = new Set((users ?? []).map((user) => user.id));
  for (const device of devices ?? []) {
    if (device.userId && known.has(device.userId)) byUser.set(device.userId, [...(byUser.get(device.userId) ?? []), device]);
    else loose.push(device);
  }
  const person = (user: ServerUser): AccessPerson => {
    const own = sortDevices(byUser.get(user.id) ?? []);
    return { key: user.id, user, name: user.displayName, devices: own, self: own.some((device) => device.current) };
  };
  const all = (users ?? []).map(person);
  const people = all.filter((entry) => isManagement(entry.user!))
    .sort((a, b) => Number(b.self) - Number(a.self) || b.user!.rank - a.user!.rank || a.name.localeCompare(b.name));
  const packUsers = all.filter((entry) => !isManagement(entry.user!)).sort((a, b) => a.name.localeCompare(b.name));
  const owners = new Map<string, ServerDevice[]>();
  for (const device of loose) {
    const name = device.userName ?? '';
    owners.set(name, [...(owners.get(name) ?? []), device]);
  }
  const others = [...owners].map(([name, list]): AccessPerson => {
    const sorted = sortDevices(list);
    return { key: `device-owner:${name}`, user: null, name, devices: sorted, self: sorted.some((device) => device.current) };
  }).sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
  return { people, packUsers, others };
}

/** Devices this launcher's user may rename: their own (the agent enforces the same). */
export function renamable(device: ServerDevice, devices: readonly ServerDevice[]): boolean {
  const own = devices.find((entry) => entry.current);
  return !!own && !device.revoked && device.userId !== null && device.userId === own.userId;
}

/** A device name the agent accepts: 1–64 characters, no control characters. */
export function deviceNameProblem(name: string): 'empty' | 'long' | 'invalid' | null {
  if (!name.trim()) return 'empty';
  if ([...name].length > 64) return 'long';
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(name) ? 'invalid' : null;
}

/** "2 devices · 1 active" style summary counts for a person. */
export const activeDevices = (person: Pick<AccessPerson, 'devices'>) => person.devices.filter((device) => !device.revoked).length;
