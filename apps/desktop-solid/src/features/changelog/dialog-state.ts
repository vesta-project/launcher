import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { whatsNew } from '../whats-new';

export const [changelogOpen, setChangelogOpen] = createSignal(false, { name: 'changelogOpen' });
export const openChangelog = () => setChangelogOpen(true);

/**
 * The update prompt's "what changed" link: the release's highlights the first time (once seen
 * they never come back on their own), the full changelog after that. What's New links to the
 * changelog itself, so nothing is out of reach either way.
 */
export async function openUpdateNotes() {
  const version = isTauri() ? await getVersion().catch(() => undefined) : undefined;
  const unseen = version ? whatsNew.unseenFor(version) : undefined;
  if (unseen) whatsNew.show(unseen);
  else openChangelog();
}
