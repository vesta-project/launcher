import { createSignal, onCleanup } from 'solid-js';

/** Typing pause before a list filter applies. Long enough to coalesce a burst of keys. */
export const SEARCH_SETTLE_MS = 120;

/**
 * Search text for a large list. `text` follows the field immediately; `applied` is what the
 * list filters by and only changes once typing pauses (or at once when cleared), so a burst of
 * keys re-renders the rows once instead of on every key.
 */
export function createSearchQuery(name: string, settleMs = SEARCH_SETTLE_MS) {
  const [text, setText] = createSignal('', { name: `${name}:text` });
  const [applied, setApplied] = createSignal('', { name: `${name}:applied` });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = () => { clearTimeout(timer); timer = undefined; };
  onCleanup(settle);
  const set = (value: string) => {
    setText(value);
    settle();
    if (!value.trim()) setApplied('');
    else timer = setTimeout(() => { timer = undefined; setApplied(value); }, settleMs);
  };
  return { text, applied, set };
}
