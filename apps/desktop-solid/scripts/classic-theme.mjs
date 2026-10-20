import { readFile, writeFile } from 'node:fs/promises';

/** Convert our trusted fixture to document scope, not an untrusted-CSS sanitizer. */
export function classicAuthorTheme(css) {
  const marker = "[data-vesta-theme-example='windows-2000']";
  if (!css.includes(marker)) throw new Error('Classic fixture scope has changed.');
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
    css: css.replaceAll(marker, ':root'),
  };
}

if (import.meta.main) {
  const fixture = await readFile(new URL('../src/styles/themes/windows-2000.css', import.meta.url), 'utf8');
  const theme = classicAuthorTheme(fixture);
  await writeFile(new URL('../examples/windows-2000.vestatheme', import.meta.url), `${JSON.stringify(theme, null, 2)}\n`);
}
