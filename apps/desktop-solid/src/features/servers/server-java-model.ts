// Pure rules for the server's Java picker (D5), modelled on the launcher's Settings → Java
// page: runtimes grouped per major version, the one this server uses, managed downloads for
// a missing version, and an optional allowlisted custom path. The agent re-checks it all.
import type { MessageId } from '../../localization/messages';
import type { SoftwareJob, SoftwarePlan } from './hosting-native';
import type { ServerJavaInventory, ServerJavaRuntime } from './native-java';

export type JavaSource = 'managed' | 'detected' | 'custom';

export interface JavaRow {
  runtime: ServerJavaRuntime;
  source: JavaSource;
  selected: boolean;
}

export interface JavaGroup {
  major: number;
  rows: JavaRow[];
  /** The server's selected runtime is in this group. */
  inUse: boolean;
  /** The current software needs exactly this major. */
  required: boolean;
  /** No runtime of this major yet; the agent can download a managed one. */
  missing: boolean;
}

/** Majors offered as managed downloads when none is installed (current LTS lines). */
export const MANAGED_OFFER = [25, 21, 17] as const;

/** Managed downloads are the agent's; a selected runtime the agent didn't list came from a custom path. */
export function javaSource(runtime: ServerJavaRuntime, listed: boolean): JavaSource {
  if (runtime.managed) return 'managed';
  return listed ? 'detected' : 'custom';
}

const sourceOrder: Record<JavaSource, number> = { managed: 0, detected: 1, custom: 2 };

/**
 * One group per major, newest first, each with the selected runtime first, then managed,
 * detected and custom, then by vendor and path. A required major with nothing installed
 * still gets a group, so its download sits where the runtime will appear.
 */
export function javaGroups(inventory: ServerJavaInventory, requiredMajor: number | null): JavaGroup[] {
  const listed = new Set(inventory.runtimes.map((runtime) => runtime.id));
  const all = [...inventory.runtimes];
  if (inventory.selected && !listed.has(inventory.selected.id)) all.push(inventory.selected);
  const rows = all.map((runtime): JavaRow => ({
    runtime,
    source: javaSource(runtime, listed.has(runtime.id)),
    selected: inventory.selected?.id === runtime.id,
  }));
  const majors = new Set(rows.map((row) => row.runtime.major));
  if (requiredMajor !== null) majors.add(requiredMajor);
  return [...majors].sort((a, b) => b - a).map((major) => {
    const group = rows
      .filter((row) => row.runtime.major === major)
      .sort((a, b) => Number(b.selected) - Number(a.selected) || sourceOrder[a.source] - sourceOrder[b.source]
        || a.runtime.vendor.localeCompare(b.runtime.vendor) || a.runtime.path.localeCompare(b.runtime.path));
    return { major, rows: group, inUse: group.some((row) => row.selected), required: major === requiredMajor, missing: group.length === 0 };
  });
}

/** Managed majors worth offering: the required one first, then current LTS lines not installed yet. */
export function downloadOffers(inventory: ServerJavaInventory, requiredMajor: number | null): number[] {
  const installed = new Set(inventory.runtimes.map((runtime) => runtime.major));
  const wanted = [...(requiredMajor === null ? [] : [requiredMajor]), ...MANAGED_OFFER];
  return [...new Set(wanted)].filter((major) => !installed.has(major));
}

export const javaSourceMessage: Record<JavaSource, MessageId> = {
  managed: 'server-java.source-managed',
  detected: 'server-java.source-detected',
  custom: 'server-java.source-custom',
};

export function javaGroupStatus(group: JavaGroup): MessageId {
  if (group.inUse) return 'server-java.group-in-use';
  if (group.missing) return 'server-java.group-missing';
  return group.required ? 'server-java.group-required' : 'server-java.group-available';
}

// ------------------------------------------------------------------ plan compatibility

export interface JavaCompatibility {
  state: 'ok' | 'incompatible' | 'unknown';
  required: number;
  selected: number | null;
  /** The managed major the agent offers to download, when one would fix it. */
  download: number | null;
}

/** Reads the plan's own Java verdict; an older agent without it is "unknown", never "ok". */
export function javaCompatibility(plan: Pick<SoftwarePlan, 'java' | 'javaCompatible' | 'selectedJavaMajor' | 'managedDownloadMajor'>): JavaCompatibility {
  const state = plan.javaCompatible === true ? 'ok' : plan.javaCompatible === false ? 'incompatible' : 'unknown';
  return { state, required: plan.java.major, selected: plan.selectedJavaMajor ?? null, download: plan.managedDownloadMajor ?? null };
}

/** An installed runtime of the major the plan needs, which could be selected instead of downloading. */
export function runtimeFor(inventory: ServerJavaInventory | undefined, major: number): ServerJavaRuntime | null {
  return inventory?.runtimes.filter((runtime) => runtime.major === major).sort((a, b) => Number(b.managed) - Number(a.managed))[0] ?? null;
}

// ------------------------------------------------------------------ custom path and jobs

/** Checks a typed custom path before it leaves the UI. The agent's allowlist and probe decide. */
export function customPathProblem(value: string): MessageId | null {
  const path = value.trim();
  if (!path) return 'server-java.custom-empty';
  if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(path) || /(^|[\\/])\.\.([\\/]|$)/.test(path)) return 'server-java.custom-absolute';
  if (!/(^|[\\/])javaw?(\.exe)?$/i.test(path)) return 'server-java.custom-executable';
  return null;
}

export const isJavaJob = (job: Pick<SoftwareJob, 'kind'> | null | undefined) => job?.kind === 'java_select' || job?.kind === 'java_download';

/** Copy for a finished Java job. */
export function javaJobMessage(job: Pick<SoftwareJob, 'kind' | 'state'>): MessageId {
  if (job.state === 'succeeded') return job.kind === 'java_download' ? 'server-java.download-done' : 'server-java.select-done';
  if (job.state === 'failed' || job.state === 'recovery_required') return job.kind === 'java_download' ? 'server-java.download-failed' : 'server-java.select-failed';
  return job.kind === 'java_download' ? 'server-java.downloading' : 'server-java.selecting';
}

/** Rejection copy for selection and downloads. */
export function javaRejection(code: string, reason: string | null | undefined): MessageId {
  if (reason === 'software_state_unavailable') return 'server-java.stop-first';
  if (reason === 'software_forbidden') return 'server-java.owner-only';
  if (code === 'forbidden') return 'server-java.custom-refused';
  if (code === 'invalid_input') return 'server-java.custom-unusable';
  return 'server-java.failed';
}
