import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const stylesheets = (dir) => readdirSync(join(root, dir), { recursive: true })
  .filter((name) => String(name).endsWith('.css'))
  .map((name) => join(dir, String(name)));

describe('[browse] clicks answer before a page of cards is built', () => {
  const results = read('src/pages/browse/results.tsx');

  test('the list renders a first screenful, then the rest in idle batches', () => {
    expect(results).toMatch(/<For each=\{renderedHits\(\)\}/);
    expect(results).toMatch(/requestIdleCallback\(more/);
  });

  test('a list shown again restores its offset only after being hidden, never over the mount restore', () => {
    expect(results).toMatch(/if \(hidden && pane && pane\.scrollTop !== top\) pane\.scrollTop = top;/);
  });
});

describe('[browse] leaving and coming back keeps the built page', () => {
  test('the shell keeps Browse mounted once visited, like Create', () => {
    const shell = read('src/app/shell.tsx');
    expect(shell).toMatch(/<Show when=\{keepBrowse\(\)\}><div style=\{\{ display: route\(\)\.page === 'browse' \? 'contents' : 'none' \}\}><BrowsePage \/>/);
    expect(shell).not.toMatch(/<Match when=\{route\(\)\.page === 'browse'\}>/);
  });

  test('hidden Browse neither applies the route nor keeps a server target synced', () => {
    const page = read('src/pages/browse/browse-page.tsx');
    expect(page).toMatch(/<Browser active=\{\(\) => shown\(\) && !onProject\(\)\} \/>/);
    expect(page).toMatch(/<Show when=\{shown\(\)\}>\s*<ServerTargetSync \/>/);
  });
});

describe('[styles] no selector restyles the whole document on every DOM change', () => {
  // Every element carries data-vesta, so an ancestor :has() at the root is invalidated by any
  // insertion anywhere; publish the state as an attribute on the root instead.
  const rootHas = /(?:^|[\s,{])(?:html|body|:root|\[data-vesta=['"]?(?:shell|scene|welcome)['"]?\]):has\(/m;
  test('no root-level :has() in any stylesheet', () => {
    expect([...stylesheets('src'), ...stylesheets('ui')].filter((file) => rootHas.test(read(file)))).toEqual([]);
  });
});
