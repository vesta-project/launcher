import type { JSX } from "solid-js";
import "./instance-header.css";

/**
 * Icon, title and one meta row, shared by the instance and server headers so both
 * draw the same box. Meta items are inline facts; a trailing control must not
 * grow the row (see [data-vesta=instance-header-meta] in instance-header.css).
 */
export function HeaderIdentity(props: { icon: string; title: string; children: JSX.Element }) {
  return (
    <>
      <img data-vesta="instance-header-icon" src={props.icon} alt="" draggable="false" />
      <div data-vesta="instance-header-copy">
        <h1 data-vesta="instance-header-title">{props.title}</h1>
        <p data-vesta="instance-header-meta">{props.children}</p>
      </div>
    </>
  );
}
