import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// RUSTSEC-2026-0382 / CVE-2026-111943. The verifier blocklist is required
// even after removing roots: compromised intermediates have cross-signs.
const atLeast = (version, floor) => {
  if (version.includes('-')) return false;
  const parts = version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i];
  }
  return true;
};

for (const file of ["Cargo.lock","apps/desktop-solid/src-tauri/Cargo.lock"]) {
  test(`${file} rejects affected Rust verifier and root bundles`, () => {
    const lock = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    let verifier = false;
    let roots = false;
    for (const [, name, version] of lock.matchAll(/\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g)) {
      if (name === 'rustls-webpki') {
        verifier = true;
        assert.ok(atLeast(version, [0, 103, 16]), `${name} ${version} requires the distrust patch`);
      }
      if (name === 'webpki-roots' || name === 'webpki-root-certs') {
        roots = true;
        // 0.26.11 forwards to 1.x, which is checked independently above/below.
        assert.ok(
          (name === 'webpki-roots' && version.startsWith('0.26.') && atLeast(version, [0, 26, 11]))
          || atLeast(version, [1, 0, 10]),
          `${name} ${version} contains an obsolete trust bundle`,
        );
      }
    }
    assert.ok(verifier && roots, 'the actual application TLS dependencies must be checked');
  });
}

