import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dir, '..');
const assets = join(root, 'src', 'assets');

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

// A whole string literal naming a bundled icon: 'icons/actions/refresh', "icons/rail/library".
// Built names (`icons/${kind}`, "branding/" + id) cannot be checked statically and are skipped.
const literal = /(['"`])(icons\/[a-z0-9-]+(?:\/[a-z0-9-]+)+)\1/g;

function references() {
  const found = [];
  for (const file of [...sources(join(root, 'src')), ...sources(join(root, 'ui'))]) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(literal)) {
      const line = text.slice(0, match.index).split('\n').length;
      found.push({ name: match[2], at: `${relative(root, file)}:${line}` });
    }
  }
  return found;
}

describe('icon references', () => {
  const found = references();

  test('the scan sees the icons the app uses', () => {
    expect(found.length).toBeGreaterThan(100);
    expect(found.some((ref) => ref.name === 'icons/actions/refresh')).toBe(true);
  });

  test('every literal icon name has a bundled svg', () => {
    const missing = found.filter((ref) => !existsSync(join(assets, `${ref.name}.svg`)));
    expect(missing.map((ref) => `${ref.name} (${ref.at})`)).toEqual([]);
  });

  test('refresh and restart share the 24px, 2px round-stroke action family', () => {
    for (const name of ['refresh', 'reload']) {
      const svg = readFileSync(join(assets, 'icons', 'actions', `${name}.svg`), 'utf8');
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toContain('stroke-width="2"');
      expect(svg).toContain('stroke-linecap="round"');
    }
  });
});
