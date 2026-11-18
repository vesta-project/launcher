import { describe, expect, test } from 'bun:test';
import { compareCores, momentFor, versionCore } from '../src/features/whats-new/moments';

const featured = ['0.2.0', '0.3.0', '0.5.0'];

describe("what's new moments", () => {
  test('reads version cores, ignoring prefixes and prereleases', () => {
    expect(versionCore('v0.2.0-alpha.1')).toEqual([0, 2, 0]);
    expect(versionCore('1.4')).toEqual([1, 4, 0]);
    expect(versionCore('nightly')).toBeUndefined();
    expect(compareCores('0.2.0-alpha.3', '0.2.0')).toBe(0);
    expect(compareCores('0.10.0', '0.9.9')).toBeGreaterThan(0);
  });

  test('a fresh install, a repeat launch or a downgrade shows nothing', () => {
    expect(momentFor({ previous: null, current: '0.2.0' }, featured)).toBeUndefined();
    expect(momentFor({ current: '0.2.0' }, featured)).toBeUndefined();
    expect(momentFor({ previous: '0.3.0', current: '0.3.0' }, featured)).toBeUndefined();
    expect(momentFor({ previous: '0.3.0', current: '0.2.0' }, featured)).toBeUndefined();
    expect(momentFor({ previous: '0.2.0-alpha.1', current: '0.2.0-alpha.2' }, featured)).toBeUndefined();
  });

  test('coming from the old launcher is the welcome back, with the newest reel reached', () => {
    expect(momentFor({ previous: '0.1.0-alpha.31', current: '0.2.0-alpha.1' }, featured)).toEqual({ kind: 'reborn', version: '0.2.0' });
    expect(momentFor({ previous: '0.1.0-alpha.31', current: '0.3.2' }, featured)).toEqual({ kind: 'reborn', version: '0.3.0' });
    expect(momentFor({ previous: '0.1.0', current: '0.2.0' }, [])).toEqual({ kind: 'reborn', version: '0.2.0' });
  });

  test('a feature update shows its highlights once, patches stay quiet', () => {
    expect(momentFor({ previous: '0.2.4', current: '0.3.0' }, featured)).toEqual({ kind: 'update', version: '0.3.0' });
    expect(momentFor({ previous: '0.2.0', current: '0.5.1' }, featured)).toEqual({ kind: 'update', version: '0.5.0' });
    expect(momentFor({ previous: '0.3.0', current: '0.3.1' }, featured)).toBeUndefined();
    expect(momentFor({ previous: '0.3.0', current: '0.4.0' }, featured)).toBeUndefined();
  });
});
