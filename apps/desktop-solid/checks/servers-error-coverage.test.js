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
