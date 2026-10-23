import type { PageId } from './router';
import type { MessageId } from '../localization/messages';
import { resolveServerLocation } from '../features/servers/shell-model';

/** Canonicalize legacy server tabs before publishing them to reactive route readers. */
export function normalizeServerPath(path: string): string {
  const [page, id, detail, item] = path.split('/').filter(Boolean);
  if (page !== 'servers' || !id) return path;
  const location = resolveServerLocation(detail, item);
  return location.redirect ? `/servers/${id}/${location.redirect}` : path;
}

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

/** Optional rail destination; users can remove it from the sidebar (`servers_in_rail`). */
export const serversNav: NavItem = { id: 'servers', label: 'nav.servers', icon: 'icons/rail/servers', href: '/servers' };

/** Rail destination pinned to the bottom. */
export const settingsNav: NavItem = { id: 'settings', label: 'nav.settings', icon: 'icons/rail/settings', href: '/settings' };
