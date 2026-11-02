import { combineProps } from '@solid-primitives/props';
import { omit, untrack } from 'solid-js';

type Props = Record<string, unknown>;

/** Chain overlay and user handlers, merge styles/classes, and retain Solid 2 ref arrays. */
export function mergeElementProps<T>(a: Props, b: Props): T {
  const combined = untrack(() => combineProps(omit(a, 'ref') as Props, omit(b, 'ref') as Props));
  // Do not pass the combineProps proxy to merge/spread: it exposes the underlying
  // Solid merge record, so Solid's optimized prop walk bypasses its handler traps.
  // A plain getter facade keeps the combined handlers through every component layer.
  const result: Props = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'ref') continue;
    Object.defineProperty(result, key, { enumerable: true, get: () => combined[key] });
  }
  Object.defineProperty(result, 'ref', { enumerable: true, get: () => [a.ref, b.ref] });
  return result as T;
}