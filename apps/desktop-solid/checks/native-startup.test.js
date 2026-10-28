import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('ServerManager is registered inside native setup before pack-sync polling', () => {
  const setup = readFileSync(new URL('../../../vesta-launcher/src-tauri/src/setup.rs', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../../../vesta-launcher/src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const registration = setup.indexOf('app.manage(crate::servers::ServerManager::new()?)');
  const lookup = setup.indexOf('app.state::<std::sync::Arc<crate::servers::ServerManager>>()');
  expect(registration).toBeGreaterThan(-1);
  expect(lookup).toBeGreaterThan(registration);
  expect(setup.indexOf('.start_pack_sync_polling(', lookup)).toBeGreaterThan(lookup);
  // Registering only after setup::init returns reproduces the startup panic.
  expect(entry).not.toContain('app.manage(servers::ServerManager::new()?)');
});
