import { combineProps } from '@solid-primitives/props';
import { merge, omit } from 'solid-js';

type Props = Record<string, unknown>;

/**
 * Merge two prop sets for one element (e.g. a control that is both a tooltip
 * and a menu trigger): event handlers chain, class/style merge, refs combine.
 * combineProps only chains function refs, but Kobalte passes Solid 2 ref
 * arrays, so refs are joined as an array instead.
 *
 * The ref goes in as a later merge source, not a Proxy override: Solid's spread
 * reads a merged object's sources directly, so a Proxy's `ref` trap was skipped
 * and Kobalte never saw the trigger (tooltips anchored to the window's corner).
 */
export function mergeElementProps<T>(a: Props, b: Props): T {
  const merged = combineProps(omit(a, 'ref') as Props, omit(b, 'ref') as Props);
  return merge(merged, {
    get ref() {
      return [a.ref, b.ref];
    },
  }) as T;
}
