import { For } from 'solid-js';
import './metadata.css';

/** Independent metadata values, spaced by layout rather than punctuation. */
export function Metadata(props: { parts: readonly (string | number | null | undefined | false)[] }) {
  const parts = () => props.parts.filter((part) => part !== null && part !== undefined && part !== false && part !== '');
  return (
    <span data-vesta="metadata">
      <For each={parts()}>{(part) => <span>{part}</span>}</For>
    </span>
  );
}
