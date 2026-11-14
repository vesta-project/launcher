// Server onboarding: the routes under /servers/add and the one command that installs Vesta
// Server on the machine that will run the servers. Pure; the pages render it.

/**
 * Installs Vesta Server on a Linux machine (Debian or Ubuntu with systemd). The bootstrap
 * script verifies what it downloads. Windows install is not available yet.
 */
export const VESTA_INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/vesta-project/server/feat/host-model/scripts/bootstrap/install.sh -o /tmp/vesta-install.sh && sudo bash /tmp/vesta-install.sh --channel nightly';

/** `/servers/add/<detail>`: the start (Vesta Server setup), the install guide, the connect flow, or re-pairing. */
export type AddRoute =
  | { kind: 'start' }
  | { kind: 'connect' }
  | { kind: 'host' }
  | { kind: 'reconnect'; connectionId: string };

export function addRoute(detail: string | undefined): AddRoute {
  // The old first server step after pairing a fresh host now starts with Vesta Server setup.
  if (!detail || detail === 'setup') return { kind: 'start' };
  if (detail === 'connect') return { kind: 'connect' };
  // Hosting on this PC or on another computer is the same install now.
  if (detail === 'host' || detail === 'remote') return { kind: 'host' };
  return { kind: 'reconnect', connectionId: detail };
}
