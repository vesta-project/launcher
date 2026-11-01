import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { warningMessage } from '../src/features/servers/hosting-model';
import { hasExplicitServerErrorPresentation, serverErrorPresentation } from '../src/features/servers/errors';

const inventory = readFileSync(new URL('../../../docs/reviews/2026-10-31-error-inventory.md', import.meta.url), 'utf8');
const codes = [...inventory.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);

describe('known server error presentation coverage', () => {
  it('gives every inventoried code an explicit presentation', () => {
    expect(codes.length).toBeGreaterThan(250);
    for (const code of codes) {
      if (Object.hasOwn(warningMessage, code)) continue;
      expect(hasExplicitServerErrorPresentation(code), code).toBe(true);
      expect(serverErrorPresentation({ code: 'internal', reason: code }).message, code).not.toBe('servers.error.internal');
    }
    for (const reason of ['future_unmapped_error', '__proto__', 'constructor', 'toString']) {
      expect(hasExplicitServerErrorPresentation(reason)).toBe(false);
      expect(serverErrorPresentation({ code: 'internal', reason })).toEqual({ message: 'servers.error.internal', action: 'retry' });
      expect(serverErrorPresentation({ code: reason })).toEqual({ message: 'servers.error.internal', action: 'retry' });
    }
  });
  it('groups repeated submission codes with refresh recovery', () => {
    for (const code of codes.filter(code => code.endsWith('idempotency_conflict'))) {
      expect(serverErrorPresentation({ code: 'conflict', reason: code })).toEqual({ message: 'servers.cause.already-submitted', action: 'refresh' });
    }
  });
});

it('uses the specific download rule from a structured URL refusal', () => {
  for (const [rule, message] of [['download_redirect_limit', 'server-pack.provider-redirect'], ['download_https_without_credentials', 'server-pack.provider-host']]) {
    expect(serverErrorPresentation({ code: 'invalid_input', reason: 'content_pack_source_unsafe', issue: { code: 'content_pack_source_unsafe', rule, item: 'https://example.com/pack.zip' } })).toEqual({ message, action: 'none' });
  }
});

it('presents every native client pack reason specifically, never as the generic conflict', () => {
  // Regression: an oversized provider modpack surfaced `pack_download_unavailable` as
  // "Something else changed this first" on every Play-on-this-server attempt.
  const root = new URL('../../../', import.meta.url);
  const sources = ['pack_sync.rs', 'pack_sync_apply.rs', 'pack_sync_check.rs', 'pack_sync_legacy.rs']
    .map(name => readFileSync(new URL(`vesta-launcher/src-tauri/src/servers/${name}`, root), 'utf8'))
    .concat(readFileSync(new URL('crates/vesta-server-client/src/pack_sync.rs', root), 'utf8'));
  const reasons = [...new Set(sources.flatMap(source => [...source.matchAll(/(?:conflict|failure)\("(pack_[a-z_]+)"\)/g)].map(match => match[1])))];
  expect(reasons).toContain('pack_download_unavailable');
  expect(reasons.length).toBeGreaterThan(20);
  for (const reason of reasons) {
    expect(hasExplicitServerErrorPresentation(reason), reason).toBe(true);
    expect(serverErrorPresentation({ code: 'conflict', reason }).message, reason).not.toBe('servers.error.conflict');
  }
});
