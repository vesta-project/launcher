import type { JSX } from '@solidjs/web';
import './board.css';

/**
 * The scene's content surface: a recessed panel that scrolls on its own.
 * Pages have no header; the titlebar already says where you are.
 */
export function Board(props: { children?: JSX.Element; class?: string }) {
  return (
    <div data-vesta="board-frame">
      <div data-vesta="board" class={props.class}>
        {props.children}
      </div>
    </div>
  );
}
