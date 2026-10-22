// Durable server metadata and PNG branding. ETags and upload conditions stay native.
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);
export interface ServerBranding { name: string; description: string | null; revision: string }
/** Omit a field to preserve it. An empty description clears the displayed text. */
export interface BrandingPatch { name?: string; description?: string }
export interface RenamedDevice { id: string; name: string }
export const MAX_SERVER_ICON_BYTES = 256 * 1024;

export const serversBrandingNative = {
  branding: (connectionId: ConnectionId) => call<ServerBranding>('server_branding', { connectionId }),
  updateBranding: (connectionId: ConnectionId, patch: BrandingPatch, expectedRevision: string, intentId: string) =>
    call<ServerBranding>('server_branding_update', { connectionId, patch, expectedRevision, intentId }),
  /** Base64 PNG bytes, without a data URI prefix; null when no custom icon exists. */
  icon: (connectionId: ConnectionId) => call<string | null>('server_icon', { connectionId }),
  /** At most 256 KiB decoded. Native chooses create/replace conditions; 412 becomes stale_target.
   * After an uncertain outcome, read icon() to reconcile before creating a new intent. */
  setIcon: (connectionId: ConnectionId, pngBase64: string, intentId: string) =>
    call<void>('server_icon_set', { connectionId, pngBase64, intentId }),
  clearIcon: (connectionId: ConnectionId, intentId: string) => call<void>('server_icon_clear', { connectionId, intentId }),
  /** Only devices belonging to the caller can be renamed; the agent enforces ownership. */
  renameDevice: (connectionId: ConnectionId, deviceId: string, name: string, intentId: string) =>
    call<RenamedDevice>('server_device_rename', { connectionId, deviceId, name, intentId }),
};
