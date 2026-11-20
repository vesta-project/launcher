import { expect, test } from 'bun:test';
import { findAll, highlightLine, highlightWindow, languageFor, lineAt, lineStarts } from '../src/components/code-editor/highlight';

test('files are coloured by extension', () => {
  expect(languageFor('server.properties')).toBe('properties');
  expect(languageFor('config/chunky/config.json')).toBe('json');
  expect(languageFor('plugins/Essentials/config.yml')).toBe('yaml');
  expect(languageFor('config/spark.toml')).toBe('toml');
  expect(languageFor('README.md')).toBe('markdown');
  expect(languageFor('eula.txt')).toBe('plain');
});

test('lines split into keys, values and comments', () => {
  expect(highlightLine('view-distance=12', 'properties')).toEqual([
    { kind: 'key', text: 'view-distance' }, { kind: 'punct', text: '=' }, { text: '' }, { kind: 'number', text: '12' }, { text: '' },
  ]);
  expect(highlightLine('# comment', 'properties')).toEqual([{ kind: 'comment', text: '# comment' }]);
  const json = highlightLine('  "name": "Alex", "n": 3', 'json');
  expect(json.filter((token) => token.kind).map((token) => token.kind)).toEqual(['key', 'punct', 'string', 'punct', 'key', 'punct', 'number']);
  expect(highlightLine('enabled = true # on', 'toml').map((token) => token.kind)).toContain('comment');
});

test('the window escapes markup and marks matches, including across tokens', () => {
  const text = 'a=<b>\nkey=value';
  const lines = text.split('\n');
  const starts = lineStarts(lines);
  const matches = findAll(text, '=v');
  expect(matches).toEqual([[9, 11]]);
  const html = highlightWindow(lines, starts, 'properties', 0, 1, matches, 0);
  expect(html).toContain('&lt;b&gt;');
  expect(html).toContain('<mark data-current>=</mark>');
  expect(html).toContain('<mark data-current>v</mark>');
  expect(lineAt(starts, 9)).toBe(1);
});

test('a Markdown code block opened above the window stays a code block', () => {
  const lines = ['```', 'a', 'b', '```', '# Title'];
  const html = highlightWindow(lines, lineStarts(lines), 'markdown', 2, 4);
  expect(html.split('\n')[0]).toBe('<span data-token="code">b</span>');
  expect(html).toContain('<span data-token="heading"># Title</span>');
});
