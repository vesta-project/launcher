import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { files, iconReferences, normalizeSvg } from '../scripts/icon-references.mjs';

const root = join(import.meta.dir, '..');
const assets = join(root, 'src', 'assets');

describe('icon references', () => {
  const { found, unresolved } = iconReferences(root);

  test('the scan sees the icons the app uses', () => {
    expect(found.length).toBeGreaterThan(100);
    expect(found.some((ref) => ref.name === 'icons/actions/refresh')).toBe(true);
  });

  test('every literal icon name has a bundled svg', () => {
    const missing = found.filter((ref) => !existsSync(join(assets, `${ref.name}.svg`)));
    expect(missing.map((ref) => `${ref.name} (${ref.at})`)).toEqual([]);
  });

  test('dynamic names resolve from their finite source catalogs', () => {
    expect(unresolved).toEqual([]);
    expect(found.filter(ref => ref.at.includes('(dynamic catalog)')).length).toBeGreaterThan(20);
  });

  test('every bundled icon and branding SVG is used', () => {
    const used = new Set(found.map(ref => ref.name));
    const unused = [...files(join(assets, 'icons')), ...files(join(assets, 'branding'))]
      .filter(path => path.endsWith('.svg'))
      .map(path => relative(assets, path).replaceAll('\\', '/').replace(/\.svg$/, ''))
      .filter(name => !used.has(name));
    expect(unused).toEqual([]);
  });

  test('bundled glyphs have a single canonical path', () => {
    const byShape = new Map();
    for (const path of [...files(join(assets, 'icons')), ...files(join(assets, 'branding'))].filter(path => path.endsWith('.svg'))) {
      const shape = normalizeSvg(readFileSync(path, 'utf8'));
      byShape.set(shape, [...(byShape.get(shape) ?? []), relative(assets, path)]);
    }
    expect([...byShape.values()].filter(paths => paths.length > 1)).toEqual([]);
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

test('About Discord uses a bundled mark that inherits either theme foreground', () => {
  const about = readFileSync(join(root, 'src/pages/settings/sections/about.tsx'), 'utf8');
  expect(about).toContain("icon: 'branding/services/discord'");
  const svg = readFileSync(join(assets, 'branding/services/discord.svg'), 'utf8');
  expect(svg).toContain('viewBox="0 0 24 24"');
  expect(svg).toContain('fill="currentColor"');
  expect(svg).not.toMatch(/(?:fill|stroke)=["'](?:#|white|black)/i);
  const renderer = readFileSync(join(root, 'src/components/icon.tsx'), 'utf8');
  expect(renderer).toContain('../assets/branding/**/*.svg');
  const css = readFileSync(join(root, 'src/components/icon.css'), 'utf8');
  expect(css).toContain('color: inherit;');
});
