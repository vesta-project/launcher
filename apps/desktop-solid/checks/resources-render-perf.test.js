import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contentList, contentModels, groupContentRows, reuseContentModels, searchContentRows } from '../src/features/servers/content-model';
import { seedContentInventory } from '../src/features/servers/fixtures-content';
import { scaleFixtureRows } from '../src/platform/fixture-scale';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const source = (path) => readFileSync(join(root, path), 'utf8');
function cssFiles(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? cssFiles(path) : path.endsWith('.css') ? [path] : [];
  });
}

describe('resources list rendering cost', () => {
  test('no stylesheet puts a descendant after a positional pseudo-class', () => {
    // `X:nth-child(n) > Y` (or ` Y`) makes Blink restyle every sibling's whole subtree whenever
    // any child is inserted or removed anywhere, so each virtual-list scroll frame restyled all
    // visible rows (~750ms frames at 4x throttle with 250 resources before the fix).
    const offenders = [...cssFiles('src'), ...cssFiles('ui')].flatMap((file) => source(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .flatMap((block) => (block.split('{').at(-2) ?? '').split(','))
      .filter((selector) => /:nth-(last-)?(child|of-type)\([^)]*\)\)?\s*(>|~|\+|\s)\s*[^\s{]/.test(selector.trim()))
      .map((selector) => `${file}: ${selector.trim()}`));
    expect(offenders).toEqual([]);
  });

  test('tab panels never run a style-reading tabbable scan per DOM mutation', () => {
    const tabs = source('ui/components/tabs/tabs.tsx');
    expect(tabs).not.toContain('<KobalteTabs.Content');
    expect(tabs).not.toMatch(/getComputedStyle\(|isElementVisible/);
    expect(tabs).toMatch(/setTimeout\(check/);
  });

  test('server content search filters prebuilt models and keeps row identity', () => {
    const items = seedContentInventory('fabric').items;
    const models = contentModels(items, { filter: 'all' });
    const all = groupContentRows(searchContentRows(models, ''), 'all');
    const narrowed = groupContentRows(searchContentRows(models, 'lith'), 'all');
    const lithium = narrowed.find((row) => row.kind === 'entry');
    expect(lithium.row.name).toBe('Lithium');
    // Same wrapper object as in the unfiltered list: the virtual row is reused, not rebuilt.
    expect(all.includes(lithium)).toBe(true);
    // Same output as the one-shot helper the tests and other callers use.
    expect(contentList(items, { filter: 'all', query: 'lith' }).map((row) => row.id)).toEqual(narrowed.map((row) => row.id));
  });

  test('provider names arriving keep unchanged models', () => {
    const items = seedContentInventory('fabric').items;
    const before = contentModels(items, { filter: 'all' });
    expect(reuseContentModels(before, contentModels(items, { filter: 'all' }))).toBe(before);
    const renamed = reuseContentModels(before, contentModels(items, { filter: 'all', project: (entry) => entry.provider?.projectId === 'terralith' ? { name: 'Terralith!' } : undefined }));
    expect(renamed).not.toBe(before);
    const changed = renamed.filter((row) => !before.includes(row));
    expect(changed.map((row) => row.name)).toEqual(['Terralith!']);
  });

  test('resource lists sort once and search without re-sorting or localeCompare', () => {
    const tab = source('src/pages/library/instance/resources-tab.tsx');
    expect(tab).toContain('new Intl.Collator');
    expect(tab).not.toMatch(/\.localeCompare\(/);
    expect(tab).toMatch(/name: "resources:sorted"/);
    const model = source('src/features/servers/content-model.ts');
    expect(model).not.toMatch(/localeCompare\(b\.name, undefined/);
  });

  test('both resource lists coalesce search keystrokes before filtering', () => {
    for (const file of ['src/pages/library/instance/resources-tab.tsx', 'src/pages/servers/tabs/resources-tab.tsx']) {
      const tab = source(file);
      expect(tab).toContain('createSearchQuery(');
      expect(tab).toContain('value={search.text()}');
    }
  });

  test('fixtures scale to a requested row count with unique keys', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(scaleFixtureRows(rows, (row, copy) => ({ id: `${row.id}-${copy}` }))).toBe(rows);
    globalThis.localStorage ??= { store: {}, getItem(key) { return this.store[key] ?? null; }, setItem(key, value) { this.store[key] = String(value); }, removeItem(key) { delete this.store[key]; } };
    localStorage.setItem('vesta:fixture-rows', '7');
    try {
      const scaled = scaleFixtureRows(rows, (row, copy) => ({ id: `${row.id}-${copy}` }));
      expect(scaled).toHaveLength(7);
      expect(new Set(scaled.map((row) => row.id)).size).toBe(7);
    } finally { localStorage.removeItem('vesta:fixture-rows'); }
  });
});
