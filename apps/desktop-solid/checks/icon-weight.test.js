import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dir, '..', 'src/components/icon.css'), 'utf8');
const component = readFileSync(join(import.meta.dir, '..', 'src/components/icon.tsx'), 'utf8');

test('[icons] outline weight follows the rendered icon size, not the 24-unit drawing', () => {
  // Small menu icons stay light beside text; rail and large icons stay sturdy.
  expect(css).toContain('container-type: size;');
  expect(css).toMatch(/svg\[stroke\][^{]*\{[^}]*stroke-width: clamp\([^;]*cqi[^;]*\);/);
  expect(css).toMatch(/vector-effect: non-scaling-stroke;/);
});

test('[icons] bundled branding keeps its authored strokes', () => {
  expect(component).toContain("data-scale-stroke={props.name.startsWith('icons/') ? '' : undefined}");
  const strokeSelector = ":where([data-vesta='icon'][data-scale-stroke]) > :where(svg[stroke])";
  expect(css.replace(/\s+/g, ' ')).toContain(`${strokeSelector}, ${strokeSelector} :where(*) {`);
  expect(css).not.toContain(":where([data-vesta='icon']) > :where(svg[stroke])");
});
