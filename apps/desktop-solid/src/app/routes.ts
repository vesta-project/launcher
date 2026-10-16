import type { PageId } from './router';
import type { MessageId } from '../localization/messages';

export interface NavItem {
  id: PageId;
  label: MessageId;
  icon: string;
  href: string;
}

/** Rail destinations above the pinned instances. All rail icons share one stroke family (icons/rail). */
export const mainNav: NavItem[] = [
  { id: 'library', label: 'nav.library', icon: 'icons/rail/library', href: '/library' },
  { id: 'create', label: 'nav.create', icon: 'icons/rail/add', href: '/create' },
  { id: 'browse', label: 'nav.browse', icon: 'icons/rail/browse', href: '/browse' },
];

/** Rail destination pinned to the bottom. */
export const settingsNav: NavItem = { id: 'settings', label: 'nav.settings', icon: 'icons/rail/settings', href: '/settings' };
