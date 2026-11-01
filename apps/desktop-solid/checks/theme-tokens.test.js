import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dir, '..');
// Exact colour expressions only: these encode user-selected colours, artwork,
// or a colour-editing spectrum. No component file is exempted wholesale.
const exceptions = {
  'src/pages/library/library-page.css': {
    reason: 'User-selected folder hue and colour-picker swatches; not theme chrome.',
    values: ['hsl(var(--library-folder-hue) 45% 55% / 14%)', 'hsl(var(--library-folder-hue) 25% 5% / 22%)', 'hsl(var(--library-folder-hue) 25% 5% / 74%)', 'hsl(var(--library-folder-hue) 25% 5% / 92%)', 'hsl(var(--library-folder-hue, 205) 45% 50%)', 'hsl(var(--library-folder-swatch) 65% 75% / 65%)', 'hsl(var(--library-folder-swatch) 55% 55% / 75%)'],
  },
  'src/pages/browse/browse.css': {
    reason: 'Artwork placeholder uses the project-provided hue.',
    values: ['oklch(0.6 0.1 var(--browse-hue, 250))', 'oklch(0.45 0.08 calc(var(--browse-hue, 250) + 50))'],
  },
  'src/pages/browse/project/project.css': {
    reason: 'Artwork fallback behind the media foreground/scrim pair.',
    values: ['oklch(0.34 0.07 var(--project-hue, 250))', 'oklch(0.24 0.05 calc(var(--project-hue, 250) + 50))'],
  },
  'src/components/software-mark.css': {
    reason: 'Software identity illustrations; launcher controls use semantic tokens.',
    values: ['#5aa846', '#4b8fe8', '#2bb59a', '#a86ae8', '#c9a26b', '#d466c9', '#d9873a', '#e7663a'],
  },
  'src/pages/servers/hosting/world-section.css': {
    reason: 'Overworld, Nether and End illustration colours.',
    values: ['#6fae4a', '#7a5a3a', '#c2453a', '#5a1d1d', '#dcd89a', '#6d4f8f'],
  },
  'src/pages/settings/sections/storage.css': {
    reason: 'Storage segment lightness/chroma are explicit theme hooks; hue identifies content.',
    values: ['oklch(var(--storage-segment-lightness, 0.7) var(--storage-segment-chroma, 0.13) var(--part-hue, 200))'],
  },
  'src/pages/settings/sections/appearance.css': {
    reason: 'Hue slider must display the editable colour spectrum.',
    values: ['oklch(0.7 0.14 0)', 'oklch(0.7 0.14 360)'],
  },
};

function expressions(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const matches = [];
  const pattern = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi;
  let match;
  while ((match = pattern.exec(clean))) {
    let value = match[0];
    if (!value.startsWith('#')) {
      let end = pattern.lastIndex, depth = 1;
      while (end < clean.length && depth) {
        if (clean[end] === '(') depth++;
        if (clean[end] === ')') depth--;
        end++;
      }
      value = clean.slice(match.index, end);
      pattern.lastIndex = end;
      // Relative colours and wholly token-driven channel lists remain themeable.
      if (/^\w+\(\s*from\s+var\(/i.test(value)) continue;
    }
    matches.push(value);
  }
  for (const match of clean.matchAll(/(?:[:,]\s*)(black|white|red|blue|green|yellow|gray|grey|orange|purple|pink)\b(?=\s*[;,)])/gi)) matches.push(match[1]);
  return matches;
}
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(dir, entry.name)) : entry.name.endsWith('.css') ? [resolve(dir, entry.name)] : []);
}

describe('theme token contract', () => {
  test('detects nested literals, alpha functions, hex and named colour endpoints', () => {
    expect(expressions('color: color-mix(in oklab, var(--tone), #fff); background: rgb(0 0 0 / 20%); border-color: white;')).toEqual(['#fff', 'rgb(0 0 0 / 20%)', 'white']);
    expect(expressions('/* color: #fff; */ color: oklch(from var(--tone) l c h);')).toEqual([]);
  });
  test('every exception still describes an existing expression', () => {
    for (const [path, exception] of Object.entries(exceptions)) {
      const found = expressions(readFileSync(resolve(root, path), 'utf8'));
      for (const value of exception.values) expect(found).toContain(value);
    }
  });
  test('component CSS has no unapproved hard-coded colours', () => {
    const failures = [];
    for (const file of [...files(resolve(root, 'src')), ...files(resolve(root, 'ui'))]) {
      const path = relative(root, file).replaceAll('\\', '/');
      // Palette definitions, default foundation, and authored example themes own literals.
      if (path.startsWith('src/styles/tokens/') || path.startsWith('src/styles/themes/') || path === 'ui/foundation/tokens.css') continue;
      for (const value of expressions(readFileSync(file, 'utf8'))) {
        if (!exceptions[path]?.values.includes(value)) failures.push(`${path}: ${value}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
