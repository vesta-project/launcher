import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

// Comments name the same hooks the rules do, so they are dropped before anything is matched.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of the first rule whose selector contains `selector`. */
const rule = (source, selector) => {
  const match = source.match(new RegExp(`[^{}]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{}]*\\{([^}]*)\\}`));
  if (!match) throw new Error(`No rule for ${selector}`);
  return match[1];
};

const css = read('ui/components/button/button.css');
test('button variants share border-box height and sizes select control tokens', () => {
  const base = css.match(/:where\(\[data-vesta='button'\]\)\s*\{([^}]*)\}/)[1];
  expect(base).toMatch(/box-sizing:\s*border-box/);
  expect(base).toMatch(/block-size:\s*var\(--button-height\)/);
  expect(base).toMatch(/--button-height:\s*var\(--vesta-size-control-md\)/);
  for (const size of ['sm', 'lg']) {
    expect(css).toMatch(new RegExp(`data-size='${size}'[\\s\\S]*?--button-height:\\s*var\\(--vesta-size-control-${size}\\)`));
  }
  for (const variant of ['outline', 'ghost']) {
    const declarations = css.match(new RegExp(`data-variant='${variant}'[^{}]*\\{([^}]*)\\}`))[1];
    expect(declarations).not.toMatch(/(?:block-size|height|box-sizing)\s*:/);
  }
});

// Trimmed labels used to lose their descenders: `overflow: hidden` clips both axes, and a
// fixed block-size leaves no room for the line box. Clip across, grow down.
const trimmed = {
  'breadcrumb label': ["ui/components/breadcrumb/breadcrumb.css", "[data-vesta='breadcrumb-label']"],
  'segmented text': ['ui/components/segmented-control/segmented-control.css', "[data-vesta='segmented-text']"],
  'browse tag': ['src/pages/browse/browse.css', "[data-vesta='browse-tag'] > span"],
  'browse chip': ['src/pages/browse/search-field.css', ":where([data-vesta='browse-chip-body'])"],
  'server files trail': ['src/pages/servers/tabs/files-tab.css', '.server-files-crumbs'],
};
for (const [name, [path, selector]] of Object.entries(trimmed)) {
  test(`${name} is clipped across without cutting the line off`, () => {
    const declarations = rule(read(path), selector);
    expect(declarations).toMatch(/overflow:\s*clip visible/);
    expect(declarations).not.toMatch(/overflow:\s*hidden/);
  });
}

test('the breadcrumb trail puts every label in the same centred box', () => {
  const markup = read('ui/components/breadcrumb/breadcrumb.tsx');
  // Both the link and the current-page branch, so a trail of mixed items shares one baseline.
  expect(markup.match(/data-vesta="breadcrumb-label"/g)).toHaveLength(2);
  const link = rule(read('ui/components/breadcrumb/breadcrumb.css'), "[data-vesta='breadcrumb-link']");
  expect(link).toMatch(/display:\s*inline-flex/);
  expect(link).toMatch(/align-items:\s*center/);
  // The ellipsis belongs to the inner label now; leaving it here would clip the icon too.
  expect(link).not.toMatch(/text-overflow|overflow\s*:/);
});

test('browse pills and chips grow with their text instead of a pinned height', () => {
  for (const [path, selector] of [
    ['src/pages/browse/browse.css', "[data-vesta='browse-tag']"],
    ['src/pages/browse/search-field.css', "[data-vesta='browse-chip']"],
  ]) {
    const declarations = rule(read(path), selector);
    expect(declarations).toMatch(/min-block-size:\s*20px/);
    expect(declarations).not.toMatch(/^\s*block-size:/m);
    expect(declarations).toMatch(/line-height:\s*var\(--vesta-leading-normal\)/);
  }
});

test('browse source icons sit at the sm control size the rest of the toolbar uses', () => {
  const sources = rule(read('src/pages/browse/browse.css'), '.browse-sources');
  // An override here made the group taller than the sort and layout controls beside it.
  expect(sources).not.toMatch(/--segmented-height/);
  expect(read('ui/components/segmented-control/segmented-control.css'))
    .toMatch(/data-size='sm'[\s\S]*?--segmented-height:\s*var\(--vesta-size-control-sm\)/);
});

test('rich text keeps an authored image height and only scales the ones without one', () => {
  const richText = read('src/pages/browse/project/rich-text.css');
  expect(rule(richText, "[data-vesta='rich-text']) :where(img)")).not.toMatch(/block-size/);
  // height alone is the provider's own sizing; width+height only states the ratio.
  expect(richText).toMatch(/img:not\(\[height\]\),\s*img\[width\]\[height\]\)\s*\{\s*block-size:\s*auto/);
});

test('changelog notes read at their own size and the columns get a real row to fill', () => {
  const changelog = read('src/pages/settings/sections/changelog-dialog.css');
  expect(rule(changelog, ".changelog-dialog :where([data-vesta='changelog-notes'])"))
    .toMatch(/--rich-text-size:\s*var\(--vesta-text-lg\)/);
  const grid = rule(changelog, "[data-vesta='changelog']");
  expect(grid).toMatch(/grid-template-columns:\s*minmax\(150px, 21%\) minmax\(0, 1fr\)/);
  expect(grid).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\)/);
});

test('the instance version notes do not borrow the changelog dialog hook', () => {
  const versions = read('src/pages/library/instance/versions-tab.css');
  expect(versions).not.toMatch(/data-vesta='changelog'/);
  expect(read('src/pages/library/instance/versions-tab.tsx')).not.toMatch(/data-vesta="changelog"/);
});
