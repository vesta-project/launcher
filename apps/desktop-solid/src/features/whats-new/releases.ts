import type { MessageId } from '../../localization/messages';

/**
 * Feature releases and the highlights each one shows off. Only add a release here when it has
 * something worth a look; patches stay quiet and keep their notes in the changelog.
 *
 * Each highlight shows a clip when it has one, otherwise its own animated scene built from the theme.
 * Clips are short silent loops bundled with the app (put them in `clips/<version>/` and import
 * them, e.g. `import browse from './clips/0.2.0/browse.webm'`), so they play offline and at once.
 * Keep them under ~2 MB, 16:9, and record them in the default theme.
 */
/** The animated pictures a highlight can use (app/whats-new/scenes.tsx). */
export type SceneName = 'paint' | 'server' | 'speed';

/** A small icon per scene, for places that list the highlights (the changelog's tile). */
export const sceneIcons: Record<SceneName, string> = {
  paint: 'icons/content/palette',
  server: 'icons/rail/servers',
  speed: 'icons/content/timer',
};

export interface Highlight {
  id: string;
  title: MessageId;
  body: MessageId;
  /** The scene shown without a clip. Give each highlight in a release its own. */
  scene: SceneName;
  clip?: { src: string; poster?: string };
  /** Somewhere to try it. Offered once the reel is over, so nobody is pulled out half way. */
  action?: { label: MessageId; route: string };
}

export interface FeatureRelease {
  version: string;
  title: MessageId;
  highlights: Highlight[];
}

export const releases: FeatureRelease[] = [
  {
    version: '0.2.0',
    title: 'whats-new.release-0-2-title',
    highlights: [
      {
        id: 'look',
        title: 'whats-new.look-title',
        body: 'whats-new.look-body',
        scene: 'paint',
        action: { label: 'whats-new.look-action', route: '/settings/appearance' },
      },
      {
        id: 'servers',
        title: 'whats-new.servers-title',
        body: 'whats-new.servers-body',
        scene: 'server',
        action: { label: 'whats-new.servers-action', route: '/servers' },
      },
      {
        id: 'speed',
        title: 'whats-new.speed-title',
        body: 'whats-new.speed-body',
        scene: 'speed',
      },
    ],
  },
];

export const featuredVersions = releases.map((release) => release.version);
export const findRelease = (version: string) => releases.find((release) => release.version === version);
