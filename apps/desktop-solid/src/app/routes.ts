import type { PageId } from './router';

export interface NavItem {
  id: PageId;
  label: string;
  icon: string;
  href: string;
}

/** Rail destinations above the pinned instances. All rail icons share one stroke family (icons/rail). */
export const mainNav: NavItem[] = [
  { id: 'library', label: 'Library', icon: 'icons/rail/library', href: '/library' },
  { id: 'create', label: 'Add instance', icon: 'icons/rail/add', href: '/create' },
  { id: 'browse', label: 'Browse', icon: 'icons/rail/browse', href: '/browse' },
];

/** Rail destination pinned to the bottom. */
export const settingsNav: NavItem = { id: 'settings', label: 'Settings', icon: 'icons/rail/settings', href: '/settings' };
