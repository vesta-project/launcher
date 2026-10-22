import type { ConnectionId, ServerCommandError } from './native';
import type { ServerDevice } from './native-manage';
import { MAX_SERVER_ICON_BYTES, type BrandingPatch, type ServerBranding } from './native-branding';

interface BrandingHost {
  server(id: ConnectionId): { snapshot: { connection: { name: string } } };
  requireCapability(target: ReturnType<BrandingHost['server']>, capability: string): void;
  wait(ms?: number): Promise<unknown>;
  devices(id: ConnectionId): Promise<ServerDevice[]>;
}
const fail = (code: ServerCommandError['code']): never => { throw { code, retryAfterMs: null } satisfies ServerCommandError; };
const clone = <T,>(v: T): T => structuredClone(v);
const controls = /[\u0000-\u001f\u007f-\u009f]/u;
const bytes = (s: string) => new TextEncoder().encode(s).length;

export function createBrandingFixtures(host: BrandingHost) {
  const branding = new Map<ConnectionId, ServerBranding>();
  const icons = new Map<ConnectionId, string>();
  const names = new Map<ConnectionId, Map<string, string>>();
  const current = (id: ConnectionId) => {
    const target = host.server(id);
    let value = branding.get(id);
    if (!value) { value = { name: target.snapshot.connection.name, description: null, revision: '0' }; branding.set(id, value); }
    return value;
  };
  return {
    async branding(id: ConnectionId) {
      await host.wait(); host.requireCapability(host.server(id), 'config.view'); return clone(current(id));
    },
    async updateBranding(id: ConnectionId, patch: BrandingPatch, expectedRevision: string, _intentId: string) {
      await host.wait(); host.requireCapability(host.server(id), 'config.edit');
      const value = current(id);
      if (!/^(0|[1-9][0-9]*)$/.test(expectedRevision)) fail('invalid_input');
      if (value.revision !== expectedRevision) fail('stale_target');
      if (!Object.keys(patch).length || Object.keys(patch).some((k) => k !== 'name' && k !== 'description')) fail('invalid_input');
      if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim() || [...patch.name].length > 128 || bytes(patch.name) > 512 || controls.test(patch.name))) fail('invalid_input');
      if (patch.description !== undefined && (typeof patch.description !== 'string' || [...patch.description].length > 1024 || bytes(patch.description) > 4096 || controls.test(patch.description.replaceAll('\n', '')))) fail('invalid_input');
      const saved = { ...value, ...patch, revision: String(BigInt(value.revision) + 1n) };
      branding.set(id, saved); return clone(saved);
    },
    async icon(id: ConnectionId) {
      await host.wait(); host.requireCapability(host.server(id), 'config.view'); return icons.get(id) ?? null;
    },
    async setIcon(id: ConnectionId, pngBase64: string, _intentId: string) {
      await host.wait(); host.requireCapability(host.server(id), 'config.edit');
      if (pngBase64.length > Math.ceil(MAX_SERVER_ICON_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(pngBase64)) fail('invalid_input');
      let png: string;
      try { png = atob(pngBase64); } catch { return fail('invalid_input'); }
      if (png.length > MAX_SERVER_ICON_BYTES || !png.startsWith('\x89PNG\r\n\x1a\n')) fail('invalid_input');
      icons.set(id, pngBase64);
    },
    async clearIcon(id: ConnectionId, _intentId: string) {
      await host.wait(); host.requireCapability(host.server(id), 'config.edit'); icons.delete(id);
    },
    async devices(id: ConnectionId) {
      return (await host.devices(id)).map((d) => ({ ...d, name: names.get(id)?.get(d.id) ?? d.name }));
    },
    async renameDevice(id: ConnectionId, deviceId: string, name: string, _intentId: string) {
      await host.wait(); host.server(id);
      const devices = await host.devices(id);
      const device = devices.find((d) => d.id === deviceId) ?? fail('not_found');
      const own = devices.find((d) => d.current);
      if (!own || device.userId !== own.userId) fail('forbidden');
      if (!name.trim() || [...name].length > 64 || controls.test(name)) fail('invalid_input');
      let renamed = names.get(id); if (!renamed) { renamed = new Map(); names.set(id, renamed); }
      renamed.set(deviceId, name); return { id: deviceId, name };
    },
  };
}
