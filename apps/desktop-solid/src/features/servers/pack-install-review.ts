// Pure rules for the server modpack install / link / update review.
import type { MessageId } from '../../localization/messages';
import { installApplyRequest, installConflicts, linkReview, type ConflictChoice } from './modpack-area-model';
import type { PackInstallApply, PackInstallPlan, SoftwareSwitchTarget } from './native-pack';

/** One server runtime: software, Minecraft version and loader version. */
export type PackRuntime = SoftwareSwitchTarget;
/** `from` is null only when an older agent flags a switch without describing it. */
export interface PackSoftwareSwitch { from: PackRuntime | null; to: PackRuntime }

export type ReviewPlan = PackInstallPlan;
export type ReviewApply = PackInstallApply;

/**
 * The switch the install performs, if any. Prefers the plan's own description; older agents only
 * flag `softwareSwitchRequired`, so the target falls back to the plan's runtime and the source to
 * what the launcher last read.
 */
export function planSoftwareSwitch(plan: ReviewPlan, current: PackRuntime | null = null): PackSoftwareSwitch | null {
  if (plan.softwareSwitch) return plan.softwareSwitch;
  if (!plan.softwareSwitchRequired) return null;
  return { from: current, to: { software: plan.software, minecraftVersion: plan.minecraftVersion, loaderVersion: plan.loaderVersion } };
}

/** Why Install is disabled, or null when it may proceed. A software switch needs one acknowledgement. */
export function reviewBlocker(plan: ReviewPlan, acknowledged: boolean): MessageId | null {
  if (!plan.valid) return 'server-pack.install-invalid';
  if (planSoftwareSwitch(plan) && !acknowledged) return 'server-pack.review-switch-needs-ack';
  return null;
}

/** The apply request: every conflict decided, plus the switch acknowledgement when the plan switches. */
export function reviewApplyRequest(plan: ReviewPlan, picks: Record<string, ConflictChoice>, acknowledged: boolean): ReviewApply | null {
  if (reviewBlocker(plan, acknowledged)) return null;
  const request = installApplyRequest(plan, picks);
  if (!request) return null;
  return planSoftwareSwitch(plan) ? { ...request, acknowledgeSoftwareSwitch: true } : request;
}

export type ReviewCountKey = 'added' | 'updated' | 'removed' | 'overrides' | 'skipped';
export interface ReviewCount { key: ReviewCountKey; paths: string[] }

/** The compact summary: non-empty change groups in a fixed order, then conflicts separately. */
export function reviewCounts(plan: ReviewPlan): ReviewCount[] {
  const review = linkReview(plan);
  const groups: ReviewCount[] = [
    { key: 'added', paths: review.added },
    { key: 'updated', paths: review.updated },
    { key: 'removed', paths: review.removed },
    { key: 'overrides', paths: review.overrides },
    { key: 'skipped', paths: plan.skipped },
  ];
  return groups.filter((group) => group.paths.length > 0);
}

/** True when nothing would change on the server (the selected version is already installed). */
export const reviewEmpty = (plan: ReviewPlan) => reviewCounts(plan).every((group) => group.key === 'skipped') && installConflicts(plan).length === 0;

/** "Back up first" is offered when a profile can run now; on by default when backups are configured. */
export function backupProfileFor(profiles: readonly { name: string; mode: 'online' | 'stopped' }[], running: boolean): string | null {
  return (running ? profiles.find((profile) => profile.mode === 'online') : profiles[0])?.name ?? null;
}

/** Display names for runtime switch lines; unknown ids stay as sent. */
const softwareNames: Record<string, string> = {
  vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', paper: 'Paper', purpur: 'Purpur', spigot: 'Spigot',
};
export const softwareName = (software: string) => softwareNames[software] ?? software;
export const runtimeLabel = (runtime: PackRuntime) => `${softwareName(runtime.software)} ${runtime.minecraftVersion}`;
