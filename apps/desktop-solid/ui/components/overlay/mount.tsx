import type { JSX } from '@solidjs/web';
import { createContext, useContext } from 'solid-js';

interface OverlayMountValue {
  mount?: Element;
}

const OverlayMountContext = createContext<OverlayMountValue>({});

/**
 * Where portalled overlays (menus, popovers, dialogs, tooltips) attach.
 * Defaults to document.body. Provide an element inside a themed or
 * [data-vesta-scheme] subtree so overlays inherit that subtree's tokens.
 */
export function OverlayMount(props: { mount: Element | undefined; children: JSX.Element }) {
  return (
    <OverlayMountContext
      value={{
        get mount() {
          return props.mount;
        },
      }}
    >
      {props.children}
    </OverlayMountContext>
  );
}

/** Mount element for the nearest OverlayMount, or undefined for document.body. */
export function useOverlayMount(): Element | undefined {
  return useContext(OverlayMountContext).mount;
}
