// Pure rules for setting up and editing backup profiles from the launcher.
import type { BackupConfigDraft, BackupConfiguration, BackupProfileConfig } from './native-backups-config';
import { defaultBackupProfile } from './native-backups-config';

/**
 * The Backups tab exists when backups are set up, or when this user could set them up.
 * `canConfigure` is false only when `backups.configure` is denied.
 */
export function backupsTabVisible(configured: boolean | undefined, canConfigure: boolean, requested = false): boolean {
  return configured === true || canConfigure || (configured === undefined && requested);
}

/** The profile suggested on first setup: "daily", online, up to 14 backups at most one per day, the whole game. */
export const suggestedProfile = (): BackupProfileConfig => withSimpleRetention(
  { ...defaultBackupProfile('daily'), mode: 'online', include: [], exclude: [] }, { total: 14, thinning: 'daily' },
);

/* ---- Retention ---- */

type Retention = Pick<BackupProfileConfig, 'keepTotal' | 'keepHourly' | 'keepLast' | 'keepDaily' | 'keepWeekly' | 'keepMonthly'>;
export type Thinning = 'none' | 'hourly' | 'daily';
/** "Keep up to `total` backups", optionally at most one per hour or day. */
export interface SimpleRetention { total: number; thinning: Thinning }

/**
 * The simple form of a profile's retention, or null when it needs the advanced counts (weekly or
 * monthly tiers, or several tiers at once). A total of 0 keeps everything.
 */
export function simpleRetention(profile: Retention): SimpleRetention | null {
  if (profile.keepWeekly || profile.keepMonthly) return null;
  const tiers = ([['none', profile.keepLast], ['hourly', profile.keepHourly ?? 0], ['daily', profile.keepDaily]] as const).filter(([, count]) => count > 0);
  const total = profile.keepTotal ?? 0;
  if (!tiers.length) return { total, thinning: 'none' };
  if (tiers.length > 1) return null;
  const [[thinning, count]] = tiers;
  return total && total !== count ? null : { total: count, thinning };
}

/**
 * Applies the simple form. The tier count mirrors the total so agents without a total cap still
 * prune to the same number.
 */
export function withSimpleRetention<P extends Retention>(profile: P, retention: SimpleRetention): P {
  const { total, thinning } = retention;
  return {
    ...profile, keepTotal: total, keepLast: thinning === 'none' ? total : 0, keepHourly: thinning === 'hourly' ? total : 0,
    keepDaily: thinning === 'daily' ? total : 0, keepWeekly: 0, keepMonthly: 0,
  };
}

/** The first-time draft: one suggested profile, the server's limits, and a new repository. */
export const setupDraft = (configuration: Pick<BackupConfiguration, 'limits' | 'repository'>): BackupConfigDraft => ({
  profiles: [suggestedProfile()],
  limits: { ...configuration.limits },
  initializeRepository: !configuration.repository.initialized,
});

/** The editing draft for a configured server; never re-initializes the repository. */
export const editDraft = (configuration: Pick<BackupConfiguration, 'limits' | 'profiles'>): BackupConfigDraft => ({
  profiles: configuration.profiles.map((profile) => ({ ...profile, include: [...profile.include], exclude: [...profile.exclude] })),
  limits: { ...configuration.limits },
  initializeRepository: false,
});

export const MAX_KEEP = 1000;
export const MAX_PROFILES = 16;
const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** A profile name the agent accepts, derived from what was typed ("Before updates" → "before-updates"). */
export const profileName = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');

/** A fresh name for an added profile that doesn't clash with the others. */
export function nextProfileName(taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'manual' : `manual-${n}`;
    if (!taken.includes(name)) return name;
  }
}

export type ProfileProblem = 'name' | 'name-taken' | 'keep-range' | 'include' | 'exclude';

const control = (text: string) => [...text].some((char) => char.charCodeAt(0) < 0x20);
const relativePath = (path: string) => path.length > 0 && path.length <= 512 && !path.startsWith('/') && !control(path)
  && !/[\\:*?[\]{}]/.test(path) && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
const excludePattern = (pattern: string) => pattern.length > 0 && pattern.length <= 512 && !control(pattern)
  && !/^[!#\\]/.test(pattern) && !pattern.split('/').includes('..');

/** Whether every retention count is a whole number the agent accepts. */
export const retentionValid = (profile: Retention) =>
  [profile.keepTotal ?? 0, profile.keepHourly ?? 0, profile.keepLast, profile.keepDaily, profile.keepWeekly, profile.keepMonthly].every((value) => Number.isInteger(value) && value >= 0 && value <= MAX_KEEP);

/** True when nothing is ever pruned (all counts zero): allowed, but storage grows without bound. */
export const keepsEverything = (profile: Retention) =>
  !profile.keepTotal && !profile.keepHourly && !profile.keepLast && !profile.keepDaily && !profile.keepWeekly && !profile.keepMonthly;

/** Problems with one profile, given the other profiles in the set (not including itself). */
export function profileProblems(profile: BackupProfileConfig, others: readonly BackupProfileConfig[]): ProfileProblem[] {
  const problems: ProfileProblem[] = [];
  if (!NAME.test(profile.name)) problems.push('name');
  else if (others.some((other) => other.name === profile.name)) problems.push('name-taken');
  if (!retentionValid(profile)) problems.push('keep-range');
  if (profile.include.length > 64 || !profile.include.every(relativePath)) problems.push('include');
  if (profile.exclude.length > 64 || !profile.exclude.every(excludePattern)) problems.push('exclude');
  return problems;
}

export const draftValid = (draft: BackupConfigDraft) =>
  draft.profiles.length <= MAX_PROFILES && draft.profiles.every((profile, index) => profileProblems(profile, draft.profiles.filter((_, other) => other !== index)).length === 0);

/** One entry per line, trimmed, blanks dropped. */
export const parseList = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

export interface DraftDiff { added: string[]; removed: string[]; changed: string[] }

/** What saving would do, by profile name. A rename reads as one removed and one added. */
export function draftDiff(base: readonly BackupProfileConfig[], draft: readonly BackupProfileConfig[]): DraftDiff {
  const before = new Map(base.map((profile) => [profile.name, profile]));
  const after = new Map(draft.map((profile) => [profile.name, profile]));
  const same = (a: BackupProfileConfig, b: BackupProfileConfig) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
  return {
    added: [...after.keys()].filter((name) => !before.has(name)),
    removed: [...before.keys()].filter((name) => !after.has(name)),
    changed: [...after.entries()].filter(([name, profile]) => before.has(name) && !same(before.get(name)!, profile)).map(([name]) => name),
  };
}
export const diffCount = (diff: DraftDiff) => diff.added.length + diff.removed.length + diff.changed.length;

const normalize = (profile: BackupProfileConfig) => ({
  name: profile.name, mode: profile.mode, keepTotal: profile.keepTotal ?? 0, keepHourly: profile.keepHourly ?? 0, keepLast: profile.keepLast, keepDaily: profile.keepDaily, keepWeekly: profile.keepWeekly,
  keepMonthly: profile.keepMonthly, onMutation: profile.onMutation, warnSeconds: profile.warnSeconds, maxSnapshots: profile.maxSnapshots,
  include: profile.include, exclude: profile.exclude,
});
