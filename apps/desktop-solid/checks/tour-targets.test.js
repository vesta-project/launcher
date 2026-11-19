import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const tour = readFileSync(join(root, 'src/app/tour/tour.tsx'), 'utf8');
const rail = readFileSync(join(root, 'src/app/rail.tsx'), 'utf8');

describe('[tour] every rail step points at a rail button that exists', () => {
  test('rail-bottom sits inside the rail, so no target may look for the rail inside it', () => {
    // The rail is the outer <aside>; rail-bottom is a child of it.
    expect(rail.indexOf('data-vesta="rail"')).toBeGreaterThan(-1);
    expect(rail.indexOf('data-vesta="rail-bottom"')).toBeGreaterThan(rail.indexOf('data-vesta="rail"'));
    // A rail-bottom prefix in front of railLink() matched nothing and left the Settings step unspotted.
    expect(tour).not.toMatch(/rail-bottom"\]\s*\$\{railLink/);
  });

  test('the Settings step targets the Settings rail button', () => {
    expect(tour).toMatch(/id: 'settings'[^\n]*targets: \[railLink\('\/settings'\)\]/);
  });
});
