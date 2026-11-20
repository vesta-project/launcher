import { Show } from 'solid-js';
import { usePlayerHead } from '../features/accounts/accounts';
import './player-head.css';

/**
 * A Minecraft player's face, for lists of people (server access, players). It shows the real
 * head when the player's UUID is known and the head can be fetched, otherwise the first letter
 * of their name on a quiet tile, so a row never jumps when the image arrives.
 */
export function PlayerHead(props: { uuid?: string | null; name: string; size?: number; online?: boolean }) {
  const url = usePlayerHead(() => props.uuid ?? undefined);
  return (
    <span
      data-vesta="player-head"
      data-online={props.online ? '' : undefined}
      style={{ '--player-head-size': `${props.size ?? 36}px` }}
      aria-hidden="true"
    >
      <Show when={url()} fallback={(props.name || '?').slice(0, 1).toUpperCase()}>
        {(src) => <img src={src()} alt="" />}
      </Show>
    </span>
  );
}
