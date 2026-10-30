import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/components/button/button.css', import.meta.url), 'utf8');
test('button variants share border-box height and sizes select control tokens', () => {
  const base = css.match(/:where\(\[data-vesta='button'\]\)\s*\{([^}]*)\}/)[1];
  expect(base).toMatch(/box-sizing:\s*border-box/);
  expect(base).toMatch(/block-size:\s*var\(--button-height\)/);
  expect(base).toMatch(/--button-height:\s*var\(--vesta-size-control-md\)/);
  for (const size of ['sm', 'lg']) {
    expect(css).toMatch(new RegExp(`data-size='${size}'[\\s\\S]*?--button-height:\\s*var\\(--vesta-size-control-${size}\\)`));
  }
  for (const variant of ['outline', 'ghost']) {
    const rule = css.match(new RegExp(`data-variant='${variant}'[^{}]*\\{([^}]*)\\}`))[1];
    expect(rule).not.toMatch(/(?:block-size|height|box-sizing)\s*:/);
  }
});
