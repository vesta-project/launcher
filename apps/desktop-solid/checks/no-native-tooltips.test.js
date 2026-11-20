import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

// Heading-style component props remain component APIs; these names are not DOM nodes.
const headingProps = new Set([
  'Card', // Card title is the visible heading for a card.
  'Dialog', // Dialog title labels the dialog.
  'EmptyState', // EmptyState title is its visible headline.
  'Panel', // Panel title is its visible section heading.
  'SettingsPanel', // SettingsPanel title labels its settings section.
  'Section', // Section title is its visible heading.
  'Popover', // Popover title is its visible overlay heading.
]);
// Temporary exceptions for files another task is converting; empty when none are.
const parallelAllowList = [];

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
        const nativeElement = /^[a-z]/.test(tag) && tag !== 'title';
        const headingComponentProp = headingProps.has(tag);
        if (title && nativeElement && !headingComponentProp && !allowed) {
          const { line } = ast.getLineAndCharacterOfPosition(title.getStart(ast));
          violations.push(`${file}:${line + 1} <${tag}> title`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  expect(violations).toEqual([]);
});