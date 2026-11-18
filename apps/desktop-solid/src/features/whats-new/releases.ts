import type { MessageId } from '../../localization/messages';

/**
 * Feature releases and the highlights each one shows off. Only add a release here when it has
 * something worth a look; patches stay quiet and keep their notes in the changelog.
 *
 * Each highlight shows a clip when it has one, otherwise a small themed scene built from icons.
 * Clips are short silent loops bundled with the app (put them in `clips/<version>/` and import
 * them, e.g. `import browse from './clips/0.2.0/browse.webm'`), so they play offline and at once.
 * Keep them under ~2 MB, 16:9, and record them in the default theme.
 */
export interface Highlight {
  id: string;
  title: MessageId;
  body: MessageId;
  /** The scene shown without a clip: one hero icon with a few smaller ones around it. */
  art: { icon: string; around: string[] };
  clip?: { src: string; poster?: string };
  /** Somewhere to try it straight away. */
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
        art: { icon: 'icons/content/palette', around: ['icons/content/monitor', 'icons/content/sliders', 'icons/content/heart'] },
        action: { label: 'whats-new.look-action', route: '/settings' },
      },
      {
        id: 'browse',
        title: 'whats-new.browse-title',
        body: 'whats-new.browse-body',
        art: { icon: 'icons/rail/browse', around: ['icons/content/modpack', 'icons/content/shader', 'icons/content/resource-pack'] },
        action: { label: 'whats-new.browse-action', route: '/browse' },
      },
      {
        id: 'status',
        title: 'whats-new.status-title',
        body: 'whats-new.status-body',
        art: { icon: 'icons/actions/download', around: ['icons/content/timer', 'icons/controls/success', 'icons/content/layers'] },
      },
      {
        id: 'servers',
        title: 'whats-new.servers-title',
        body: 'whats-new.servers-body',
        art: { icon: 'icons/rail/servers', around: ['icons/content/people', 'icons/content/globe', 'icons/content/terminal'] },
        action: { label: 'whats-new.servers-action', route: '/servers' },
      },
      {
        id: 'wardrobe',
        title: 'whats-new.wardrobe-title',
        body: 'whats-new.wardrobe-body',
        art: { icon: 'icons/content/skin-icon', around: ['icons/content/cape-icon', 'icons/content/people', 'icons/content/heart'] },
      },
    ],
  },
];

export const featuredVersions = releases.map((release) => release.version);
export const findRelease = (version: string) => releases.find((release) => release.version === version);
