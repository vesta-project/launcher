import type { JSX } from '@solidjs/web';
import './board.css';

/**
 * The scene's content surface: a recessed panel that scrolls on its own.
 * Pages have no header; the titlebar already says where you are.
 */
export function Board(props: {
  children?: JSX.Element;
  class?: string;
  /** Children manage their own scrolling; the board itself does not scroll. */
  fixed?: boolean;
}) {
  return (
    <div data-vesta="board-frame">
      <div data-vesta="board" data-fixed={props.fixed ? '' : undefined} class={props.class}>
        {props.children}
      </div>
    </div>
  );
}
