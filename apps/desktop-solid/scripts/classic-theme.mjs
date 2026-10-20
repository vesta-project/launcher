import { readFile, writeFile } from 'node:fs/promises';

const marker = "[data-vesta-theme-example='windows-2000']";

/** Convert our trusted fixture to document scope, not an untrusted-CSS sanitizer. */
function documentScope(css) {
  if (!css.includes(marker)) throw new Error('Classic fixture scope has changed.');
  return css.replaceAll(marker, ':root');
}

/** The JSON envelope form (complete base). */
export function classicAuthorTheme(css) {
  return {
    type: 'vesta-author-theme',
    formatVersion: 1,
    contractVersion: 1,
    name: 'Windows 2000 capability example',
    base: {
      id: 'vesta', mode: 'light', hue: 207, material: 'flat',
      translucency: 0, grain: 0, gradient: false, gradientType: 'radial',
      gradientAngle: 135, gradientHarmony: 'analogous', borderWidth: 1,
    },
    css: documentScope(css),
  };
}

/**
 * The plain stylesheet form authors are expected to write: a `@vesta-theme` header comment,
 * then ordinary CSS. Only the settings that differ from the defaults are listed.
 */
export function classicStylesheet(css) {
  const base = { mode: 'light', material: 'flat', translucency: 0, grain: 0, gradient: false };
  return [
    '/* @vesta-theme',
    ' * name: Windows 2000',
    ' * contract: 1',
    ` * base: ${JSON.stringify(base)}`,
    ' */',
    // The fixture's own note describes the workbench story, not this file.
    documentScope(css).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').trim(),
    '',
  ].join('\n');
}

if (import.meta.main) {
  const fixture = await readFile(new URL('../src/styles/themes/windows-2000.css', import.meta.url), 'utf8');
  await writeFile(new URL('../examples/windows-2000.vestatheme', import.meta.url), `${JSON.stringify(classicAuthorTheme(fixture), null, 2)}\n`);
  await writeFile(new URL('../examples/windows-2000.css', import.meta.url), classicStylesheet(fixture));
}
