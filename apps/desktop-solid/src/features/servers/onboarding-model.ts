// Server onboarding: how a person starts (host here, host elsewhere, or connect), and the
// facts each guide relies on. Pure; the pages render it.
import type { MessageId } from '../../localization/messages';

/** Host on this computer, or on another one (a VPS, a spare PC). */
export type HostMode = 'local' | 'remote';

/**
 * Where the signed Vesta Host installer and its verified install commands are published. The
 * commands carry release pins (manifest SHA-256 and release key) that only the release page may
 * supply, so the launcher links there instead of embedding a command.
 */
export const HOST_RELEASES_URL = 'https://github.com/vesta-project/server/releases';

/** A freshly installed host listens on this computer only, on the default port. */
export const LOCAL_HOST_ADDRESS = 'localhost:8443';

/** The guide's steps, in order; connecting reuses the normal connect steps after these. */
export const hostGuideSteps: readonly MessageId[] = ['servers.step.install', 'servers.step.address', 'servers.step.verify', 'servers.step.sign-in'];

/** `/servers/add/<detail>`: a start page, a guide, the connect flow, or re-pairing a saved server. */
export type AddRoute =
  | { kind: 'start' }
  | { kind: 'connect' }
  | { kind: 'host'; mode: HostMode }
  | { kind: 'reconnect'; connectionId: string };

export function addRoute(detail: string | undefined): AddRoute {
  if (!detail) return { kind: 'start' };
  if (detail === 'connect') return { kind: 'connect' };
  if (detail === 'host') return { kind: 'host', mode: 'local' };
  if (detail === 'remote') return { kind: 'host', mode: 'remote' };
  return { kind: 'reconnect', connectionId: detail };
}

/** The address the connect step starts with: this computer for a local host, else empty. */
export const initialAddress = (mode: HostMode | undefined) => (mode === 'local' ? LOCAL_HOST_ADDRESS : '');
