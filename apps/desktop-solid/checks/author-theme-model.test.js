import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { classicAuthorTheme } from '../scripts/classic-theme.mjs';
import { generatedThemeStyles, isCurrentAppearance, MAX_THEME_FILE_BYTES } from '../src/features/settings/author-theme-model';

test('generated theme tokens live in the lower owned sublayer, not inline', () => {
  expect(generatedThemeStyles({ '--vesta-accent-hue': '207', '--vesta-radius-factor': '0' }))
    .toBe('@layer theme.generated { :root { --vesta-accent-hue: 207;\n--vesta-radius-factor: 0; } }');
});

test('late snapshots cannot replace newer authoritative selection', () => {
  expect(isCurrentAppearance(undefined, { revision: 1 })).toBe(true);
  expect(isCurrentAppearance({ revision: 4 }, { revision: 3 })).toBe(false);
  expect(isCurrentAppearance({ revision: 4 }, { revision: 4 })).toBe(true);
  expect(isCurrentAppearance({ revision: 4 }, { revision: 5 })).toBe(true);
});

test('importable classic sample is exactly the trusted fixture at document scope', async () => {
  const fixture = await readFile(new URL('../src/styles/themes/windows-2000.css', import.meta.url), 'utf8');
  const raw = await readFile(new URL('../examples/windows-2000.vestatheme', import.meta.url), 'utf8');
  const sample = JSON.parse(raw);
  expect(sample).toEqual(classicAuthorTheme(fixture));
  expect(sample.css).not.toContain('data-vesta-theme-example');
  expect(sample.css).toContain(':root');
  expect(sample.base.mode).toBe('light');
  expect(Buffer.byteLength(raw)).toBeLessThan(MAX_THEME_FILE_BYTES);
  expect(sample.type).toBe('vesta-author-theme');
});
