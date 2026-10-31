import { expect, it } from 'bun:test';
import { installWarning } from '../src/features/servers/modpack-area-model';
it('labels runtime derived from the pack manifest', () => {
  expect(installWarning({ code: 'version_from_pack_manifest', rule: 'pack_manifest_runtime', item: '4612979', detail: 'Version from pack manifest' }, id => id)).toBe('install.version-from-manifest');
});
it('shows localized archive thresholds with their exact review item', () => {
  const message = installWarning({ code: 'archive_limit_warning', rule: 'legacy_member_bytes', item: 'config/large.dat', detail: '16777217 > 16777216' }, id => id);
  expect(message).toBe('server-pack.warning-legacy-member-bytes (config/large.dat: 16777217 > 16777216)');
});
