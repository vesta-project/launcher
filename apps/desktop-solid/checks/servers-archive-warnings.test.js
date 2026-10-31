import { expect, it } from 'bun:test';
import { installWarning } from '../src/features/servers/modpack-area-model';
it('shows localized archive thresholds with their exact review item', () => {
  const message = installWarning({ code: 'archive_limit_warning', rule: 'legacy_member_bytes', item: 'config/large.dat', detail: '16777217 > 16777216' }, id => id);
  expect(message).toBe('server-pack.warning-legacy-member-bytes (config/large.dat: 16777217 > 16777216)');
});
