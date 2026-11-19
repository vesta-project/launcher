import { createSignal } from 'solid-js';

export const [changelogOpen, setChangelogOpen] = createSignal(false, { name: 'changelogOpen' });
export const openChangelog = () => setChangelogOpen(true);
