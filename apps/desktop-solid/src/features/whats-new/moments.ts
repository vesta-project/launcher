/**
 * Which "what's new" moment a launch deserves. Pure, so the rules stay easy to test:
 *  - no earlier launch recorded: a fresh install, setup and the tour cover it
 *  - coming from before the rewrite (below 0.2): the welcome back sequence
 *  - crossing into a release with highlights: that release's highlights
 *  - anything else (a patch, the same version, a downgrade): nothing
 * Only the numeric core is compared, so moving between prereleases of one version stays quiet.
 */

export interface LaunchVersions {
  previous?: string | null;
  current: string;
}

export type Moment = { kind: 'reborn'; version: string } | { kind: 'update'; version: string };

/** The release where the rewritten launcher replaced the old one. */
export const REWRITE_VERSION = '0.2.0';

/** "v0.2.0-alpha.1" reads as [0, 2, 0]; anything unreadable reads as undefined. */
export function versionCore(version: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function compareCores(a: string, b: string): number {
  const left = versionCore(a);
  const right = versionCore(b);
  if (!left || !right) return Number.NaN;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}

/**
 * `featured` lists the versions that ship highlights. The newest one past `previous` and not
 * past `current` is the one shown, so skipping several updates still shows the latest reel.
 */
export function momentFor(launch: LaunchVersions, featured: readonly string[]): Moment | undefined {
  const { previous, current } = launch;
  if (!previous || !versionCore(previous) || !versionCore(current)) return undefined;
  if (compareCores(previous, current) >= 0) return undefined;
  const reached = featured
    .filter((version) => compareCores(version, previous) > 0 && compareCores(version, current) <= 0)
    .sort((a, b) => compareCores(b, a));
  if (compareCores(previous, REWRITE_VERSION) < 0) {
    return { kind: 'reborn', version: reached[0] ?? REWRITE_VERSION };
  }
  return reached[0] ? { kind: 'update', version: reached[0] } : undefined;
}
