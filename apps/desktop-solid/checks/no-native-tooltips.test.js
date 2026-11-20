import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

// Heading-style component props remain component APIs; these names are not DOM nodes.
const headingProps = new Set(['Card', 'Dialog', 'EmptyState', 'Panel', 'SettingsPanel', 'Section', 'Popover']);
// Temporary exceptions: another parallel task owns these tooltip conversions.
const parallelAllowList = [
  { test: (file) => file === 'src/components/empty-state.tsx', reason: 'converting in parallel' },
  { test: (file) => file.startsWith('src/pages/library/instance/'), reason: 'converting in parallel' },
  { test: (file) => file === 'src/pages/servers/server-card.tsx', reason: 'converting in parallel' },
  { test: (file) => file.startsWith('src/components/log-view/'), reason: 'converting in parallel' },
];

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(tsx|jsx)$/.test(entry.name) ? [file] : [];
  });
}

test('DOM JSX does not use native title tooltips', () => {
  const violations = [];
  for (const absolute of [...sourceFiles('src'), ...sourceFiles('ui')]) {
    const file = relative('.', absolute).replaceAll('\\', '/');
    const source = readFileSync(absolute, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const allowed = parallelAllowList.find((entry) => entry.test(file));
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(ast);
        const title = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'title');
        // Lowercase tags are native DOM; <title> itself is document/SVG content, not an attribute tooltip.
        if (title && /^[a-z]/.test(tag) && tag !== 'title' && !allowed) {
          const { line } = ast.getLineAndCharacterOfPosition(title.getStart(ast));
          violations.push(`${file}:${line + 1} <${tag}> title`);
        }
        // Keep heading component exceptions explicit so future changes are reviewed intentionally.
        if (title && headingProps.has(tag)) void tag;
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  expect(violations).toEqual([]);
});