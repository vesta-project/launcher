import { createContext } from 'solid-js';

/** Popovers owning a portalled child control, nearest first. */
export const PopoverScope = createContext<readonly string[]>([]);

/** Explicit ownership works before Kobalte registers the nested dismissable layer. */
export function isPopoverChild(target: Pick<Element, 'closest'>, owner: string) {
  return target.closest('[data-vesta-popover-owner]')?.getAttribute('data-vesta-popover-owner')?.split(' ').includes(owner) ?? false;
}
