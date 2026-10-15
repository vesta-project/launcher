import { combineProps } from '@solid-primitives/props';
import { omit } from 'solid-js';

type Props = Record<string, unknown>;

/**
 * Merge two prop sets for one element (e.g. a control that is both a tooltip
 * and a menu trigger): event handlers chain, class/style merge, refs combine.
 * combineProps only chains function refs, but Kobalte passes Solid 2 ref
 * arrays, so refs are joined as an array instead.
 */
export function mergeElementProps<T>(a: Props, b: Props): T {
  const restA = omit(a, 'ref');
  const restB = omit(b, 'ref');
  const merged = combineProps(restA as Props, restB as Props);
  return new Proxy(merged, {
    get: (target, key, receiver) => (key === 'ref' ? [a.ref, b.ref] : Reflect.get(target, key, receiver)),
    has: (target, key) => key === 'ref' || Reflect.has(target, key),
    ownKeys: (target) => [...new Set([...Reflect.ownKeys(target), 'ref'])],
    getOwnPropertyDescriptor: (target, key) =>
      key === 'ref'
        ? { configurable: true, enumerable: true, value: [a.ref, b.ref] }
        : Reflect.getOwnPropertyDescriptor(target, key),
  }) as T;
}
