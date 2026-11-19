import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('instance, server and Overview world actions share hover, keyboard and running reveal', () => {
  const shared = source('components/card-play.css');
  expect(shared).toContain("[data-vesta='instance-card'], [data-vesta='overview-world-grid'] > li):is(:hover, :focus-within)");
  expect(shared).toContain('[data-card-play]:focus-visible,');
  expect(shared).toMatch(/\[data-card-play\]\[data-running\]\s*\{\s*opacity: 1;\s*pointer-events: auto;/);
  expect(shared).toMatch(/opacity: 0;\s*pointer-events: none;/);
  expect(shared).toContain('place-items: center;');
  expect(shared).toContain(':not(:disabled):active');
  expect(shared).toContain('prefers-reduced-motion: reduce');
  expect(shared).toContain('html[data-vesta-reduced-motion]');
  expect(shared.match(/transform: none; transition: none;/g)).toHaveLength(2);
  for (const path of ['features/instances/instance-card.tsx', 'pages/library/instance/overview-tab.tsx']) {
    const tsx = source(path);
    expect(tsx).toContain('data-card-play=""');
    expect(tsx).toContain('data-running={');
    expect(tsx).toContain('disabled={');
    expect(tsx).toContain('aria-label={');
  }
  expect(source('pages/library/instance/overview-tab.tsx')).toContain('components/card-play.css');
  expect(source('features/instances/instance-card.css')).toContain('components/card-play.css');
  const overview = source('pages/library/instance/overview-tab.css');
  expect(overview).not.toContain('li[data-latest]) > .overview-world-play');
  expect(overview).not.toMatch(/\.overview-world-play[^}]*opacity:/);
});
