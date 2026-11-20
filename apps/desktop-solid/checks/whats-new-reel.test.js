import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releases } from '../src/features/whats-new/releases.ts';

const root = join(import.meta.dir, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

describe('[whats-new] the highlight reel', () => {
  test('each highlight in a release tells its own scene', () => {
    for (const release of releases) {
      const scenes = release.highlights.map((highlight) => highlight.scene);
      expect(new Set(scenes).size).toBe(scenes.length);
    }
  });

  test('feature links wait for the last step, so the reel is never cut short', () => {
    const reel = read('src/app/whats-new/highlight-reel.tsx');
    expect(reel).toMatch(/<Show when=\{props\.onAction && last\(\)\}>/);
    expect(reel).not.toContain('current().action');
    // Both the update card and the welcome back sequence offer them.
    expect(read('src/app/whats-new/whats-new.tsx').match(/onAction=/g)?.length).toBe(2);
  });

  test('picking a bar restarts its fill and scene, and only the picture holds the reel', () => {
    const reel = read('src/app/whats-new/highlight-reel.tsx');
    expect(reel).toMatch(/setLap\(\(value\) => value \+ 1\)/);
    expect(reel).toMatch(/at\(\) === index\(\) && lap\(\) \+ 1\} keyed/);
    const css = read('src/app/whats-new/whats-new.css');
    expect(css).toContain("[data-vesta='reel-media']:hover) ~ :where([data-vesta='reel-segments'])");
    expect(css).not.toContain("[data-vesta='reel-stage']:hover");
  });

  test('reduced motion stills every scene and removes the drifting specks', () => {
    expect(read('src/app/whats-new/scenes.css')).toMatch(/html\[data-vesta-reduced-motion\][^{]*\[data-vesta='scene'\] \*\)\s*\{\s*animation: none;/);
    expect(read('src/pages/welcome/welcome.css')).toMatch(/html\[data-vesta-reduced-motion\] :where\(\[data-vesta='welcome-specks'\]\)\s*\{\s*display: none;/);
  });
});
