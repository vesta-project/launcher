import { invoke, isTauri } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { REWRITE_VERSION, compareCores, momentFor, type LaunchVersions, type Moment } from './moments';
import { featuredVersions, findRelease, releases } from './releases';
export { sceneIcons } from './releases';
export type { Moment } from './moments';
export type { FeatureRelease, Highlight, SceneName } from './releases';

/**
 * "What's new" after an update. The host remembers the version of the previous launch; the
 * first launch after a feature release shows its highlights once, and someone arriving from the
 * old launcher gets the welcome back sequence instead. The host records the new version on every
 * launch, so nothing needs marking as seen here.
 */
const [moment, setMoment] = createSignal<Moment | undefined>(undefined, { name: 'whatsNewMoment' });
let checked = false;

/** Releases whose highlights were shown here, so the update prompt sends you to them only once. */
const SEEN_KEY = 'vesta:whats-new-seen';
function seenVersions(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}
function markSeen(version: string) {
  const seen = seenVersions();
  if (seen.includes(version)) return;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, version])); } catch { /* a convenience only */ }
}

/** The newest release with highlights that this app version has reached. */
export function reachedRelease(appVersion: string): string | undefined {
  return featuredVersions
    .filter((version) => compareCores(version, appVersion) <= 0)
    .sort((a, b) => compareCores(b, a))[0];
}

export const whatsNew = {
  moment,
  open: () => moment() !== undefined,
  release: () => {
    const current = moment();
    return current ? findRelease(current.version) : undefined;
  },
  /** Once per app start, for someone who skipped setup because they already had it done. */
  async check() {
    if (checked) return;
    checked = true;
    if (!isTauri()) return;
    try {
      const launch = await invoke<LaunchVersions>('get_launch_versions');
      const next = momentFor(launch, featuredVersions);
      if (next && !seenVersions().includes(next.version)) setMoment(next);
    } catch (error) {
      console.error('Unable to read launch versions:', error);
    }
  },
  /** Opens a release's highlights on request, e.g. from the changelog. */
  show(version: string) {
    if (findRelease(version)) setMoment({ kind: 'update', version });
  },
  close: () => {
    const current = moment();
    if (current) markSeen(current.version);
    setMoment(undefined);
  },
  /**
   * Where the update prompt's changelog link goes: this version's highlights while they are
   * still unseen, otherwise undefined (the full changelog).
   */
  unseenFor(appVersion: string): string | undefined {
    const version = reachedRelease(appVersion);
    return version && !seenVersions().includes(version) ? version : undefined;
  },
};

/** The release whose highlights belong with a changelog entry, if it has any. */
export const highlightsFor = (tag: string) => releases.find((release) => compareCores(release.version, tag) === 0);

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const dev = window as unknown as { vestaDev?: Record<string, unknown> };
  const latest = featuredVersions[0] ?? REWRITE_VERSION;
  dev.vestaDev = {
    ...dev.vestaDev,
    whatsNew: (version = latest) => whatsNew.show(version),
    welcomeBack: () => setMoment({ kind: 'reborn', version: latest }),
  };
}
