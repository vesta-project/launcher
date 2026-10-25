// The inline "change software" flow on Settings → Software, as pure decisions: which
// software can be chosen, what the Minecraft and software version fields hold, and when the
// review step is offered. Mirrors the instance Versions tab (loader → game version → review).
import type { MessageId } from '../../localization/messages';
import { LOADERS } from './hosting-model';
import type { SoftwareDescriptor, SoftwareId, SoftwareLaunch } from './hosting-native';

/** Bundled marks: loader logos shared with instances, simple glyphs for the server forks. */
export const softwareIcon: Record<SoftwareId, string> = {
  vanilla: 'icons/rail/library',
  paper: 'branding/software/paper',
  folia: 'branding/software/folia',
  purpur: 'branding/software/purpur',
  fabric: 'branding/modloaders/fabric-logo',
  quilt: 'branding/modloaders/quilt-logo',
  forge: 'branding/modloaders/forge-logo',
  neoforge: 'branding/modloaders/neoforge-logo',
};

/** Software whose own version is a build number on top of the Minecraft version. */
const BUILDS: ReadonlySet<SoftwareId> = new Set(['paper', 'folia', 'purpur']);

/** What the "software version" means for a software: a build, a loader version, or nothing extra. */
export function softwareVersionKind(software: SoftwareId | null | undefined): 'build' | 'loader' | null {
  if (!software) return null;
  if (BUILDS.has(software)) return 'build';
  return LOADERS.has(software) ? 'loader' : null;
}

/** "build 130" / "loader 0.16.9" for a running launch; null when there is nothing beyond Minecraft. */
export function softwareVersionText(launch: SoftwareLaunch | null | undefined): string | null {
  if (!launch) return null;
  if (launch.loaderVersion) return `loader ${launch.loaderVersion}`;
  return launch.build !== null && launch.build !== undefined ? `build ${launch.build}` : null;
}

/** The label of the software version field before review, when the agent picks the newest. */
export const latestVersionLabel = (software: SoftwareId | null): MessageId | null => {
  const kind = softwareVersionKind(software);
  return kind === 'build' ? 'server-hosting.latest-build' : kind === 'loader' ? 'server-hosting.latest-loader' : null;
};

export const selectable = (entry: Pick<SoftwareDescriptor, 'automaticBackend' | 'unavailableReason'>) =>
  entry.automaticBackend && !entry.unavailableReason;

export interface SoftwareChoice {
  software: SoftwareId | null;
  /** The Minecraft version; null until one is chosen. */
  minecraft: string | null;
}

/** Keep the installed choice selected, even when it cannot be installed here; use observed version for unmanaged setups. */
export function initialChoice(catalog: readonly SoftwareDescriptor[], current: SoftwareLaunch | null, observedVersion: string | null = null): SoftwareChoice {
  const running = current?.software ? catalog.find((entry) => entry.software === current.software) : undefined;
  if (running) return { software: running.software, minecraft: current?.version ?? null };
  return { software: catalog.find(selectable)?.software ?? null, minecraft: current?.version ?? observedVersion };
}

/**
 * The Minecraft version to keep after the software or its version list changes: the same
 * one when the new list offers it, otherwise the newest offered (lists are newest first).
 */
export function keepMinecraft(versions: readonly string[] | undefined, preferred: string | null): string | null {
  if (!versions?.length) return null;
  return preferred && versions.includes(preferred) ? preferred : versions[0]!;
}

/**
 * Where the flow stands: `incomplete` until both are chosen; `same` when it matches what
 * runs (review then means "check for a newer build"); `changed` otherwise.
 */
export function choiceState(choice: SoftwareChoice, current: SoftwareLaunch | null): 'incomplete' | 'same' | 'changed' {
  if (!choice.software || !choice.minecraft) return 'incomplete';
  return current?.software === choice.software && current.version === choice.minecraft ? 'same' : 'changed';
}

/** Why changes can't start right now, or null. Order matches what the owner can fix first. */
export function changeBlocker(input: {
  available: boolean; recoveryRequired: boolean; stopped: boolean; jobRunning: boolean;
}): MessageId | null {
  if (!input.available) return 'server-hosting.software-unavailable';
  if (input.recoveryRequired) return 'server-hosting.recovery-banner';
  if (input.jobRunning) return 'server-hosting.reason-busy';
  if (!input.stopped) return 'server-hosting.stop-to-change';
  return null;
}
