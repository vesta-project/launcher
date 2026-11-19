import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dir, '..', 'src/components/icon.css'), 'utf8');

test('[icons] outline weight follows the rendered icon size, not the 24-unit drawing', () => {
  // Small menu icons stay light beside text; rail and large icons stay sturdy.
  expect(css).toContain('container-type: size;');
  expect(css).toMatch(/svg\[stroke\][^{]*\{[^}]*stroke-width: clamp\([^;]*cqi[^;]*\);/);
  expect(css).toMatch(/vector-effect: non-scaling-stroke;/);
});
