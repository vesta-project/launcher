import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const stylesheets = (dir) => readdirSync(join(root, dir), { recursive: true })
  .filter((name) => String(name).endsWith('.css'))
  .map((name) => join(dir, String(name)));

describe('[styles] no selector restyles the whole document on every DOM change', () => {
  // Every element carries data-vesta, so an ancestor :has() at the root is invalidated by any
  // insertion anywhere; publish the state as an attribute on the root instead.
  const rootHas = /(?:^|[\s,{])(?:html|body|:root|\[data-vesta=['"]?(?:shell|scene|welcome)['"]?\]):has\(/m;
  test('no root-level :has() in any stylesheet', () => {
    expect([...stylesheets('src'), ...stylesheets('ui')].filter((file) => rootHas.test(read(file)))).toEqual([]);
  });
});
