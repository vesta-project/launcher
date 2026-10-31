import type { JSX } from '@solidjs/web';
import { navigate } from '../../../app/router';

/** Shared identity and action layout for server and client modpack links. */
export function ModpackLinkCard(props: {
  phase: string;
  path?: string;
  icon: string;
  name: string;
  source: string;
  sourceName: string;
  metadata: JSX.Element;
  actions: JSX.Element;
  children?: JSX.Element;
}) {
  return <section data-vesta="modpack-link-card" data-phase={props.phase}>
    <a data-vesta="modpack-link-identity" href={props.path ? `#${props.path}` : undefined}
      onClick={event => {
        if (!props.path || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(props.path);
      }}>
      <img data-vesta="modpack-link-icon" src={props.icon} alt="" width={56} height={56} draggable="false" />
      <span data-vesta="modpack-link-title">
        <span data-vesta="modpack-link-name"><strong>{props.name}</strong><span data-vesta="source-tag" data-source={props.source}>{props.sourceName}</span></span>
        <span data-vesta="modpack-link-meta">{props.metadata}</span>
      </span>
    </a>
    <div data-vesta="modpack-link-status">{props.actions}</div>
    {props.children}
  </section>;
}
