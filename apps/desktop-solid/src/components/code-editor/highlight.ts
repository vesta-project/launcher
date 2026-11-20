/**
 * Small, dependency-free syntax colouring for the config and text files a Minecraft server
 * keeps (properties, JSON, YAML, TOML, Markdown, logs). It only colours: it never parses or
 * validates, so a half-typed line is still drawn sensibly. Each line is tokenised alone, which
 * keeps it fast on every keystroke and makes a broken line unable to spill into the rest.
 */

export type CodeLanguage = 'properties' | 'json' | 'yaml' | 'toml' | 'markdown' | 'log' | 'plain';

/** Token classes; the editor's CSS gives each a theme colour. */
export type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'comment' | 'section' | 'punct' | 'heading' | 'code' | 'warn' | 'error' | 'muted';

export interface Token { kind?: TokenKind; text: string }

const EXTENSIONS: Record<string, CodeLanguage> = {
  properties: 'properties', cfg: 'properties', ini: 'properties', conf: 'properties', txt: 'plain',
  json: 'json', json5: 'json', mcmeta: 'json', jsonc: 'json',
  yml: 'yaml', yaml: 'yaml',
  toml: 'toml',
  md: 'markdown', markdown: 'markdown',
  log: 'log',
};

/** The language a file is coloured as, from its name. */
export function languageFor(path: string): CodeLanguage {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return EXTENSIONS[ext] ?? 'plain';
}

const NUMBER = /^-?(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i;
const LITERAL = /^(?:true|false|null|yes|no|on|off|~)$/i;

/** A bare value: number, true/false/null, or plain text. */
function value(text: string): Token[] {
  const trimmed = text.trim();
  if (!trimmed) return [{ text }];
  const lead = text.slice(0, text.indexOf(trimmed));
  const tail = text.slice(lead.length + trimmed.length);
  const kind: TokenKind | undefined = NUMBER.test(trimmed) ? 'number' : LITERAL.test(trimmed) ? 'literal' : undefined;
  return [{ text: lead }, { kind: kind ?? 'string', text: trimmed }, { text: tail }];
}

/** Splits off a trailing comment that starts with `marker` outside quotes. */
function splitComment(line: string, markers: string): [string, string] {
  let quote = '';
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (markers.includes(char) && (index === 0 || /\s/.test(line[index - 1]!))) return [line.slice(0, index), line.slice(index)];
  }
  return [line, ''];
}

function properties(line: string): Token[] {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('!') || trimmed.startsWith(';')) return [{ kind: 'comment', text: line }];
  if (/^\s*\[.*\]\s*$/.test(line)) return [{ kind: 'section', text: line }];
  const at = line.search(/[=:]/);
  if (at < 0) return [{ kind: 'key', text: line }];
  return [{ kind: 'key', text: line.slice(0, at) }, { kind: 'punct', text: line[at]! }, ...value(line.slice(at + 1))];
}

const JSON_TOKEN = /("(?:[^"\\]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])|(\/\/.*$)/g;

function json(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of line.matchAll(JSON_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) tokens.push({ text: line.slice(last, at) });
    if (match[1] !== undefined) {
      tokens.push({ kind: match[2] ? 'key' : 'string', text: match[1] });
      if (match[2]) tokens.push({ kind: 'punct', text: match[2] });
    } else if (match[3] !== undefined) tokens.push({ kind: 'number', text: match[3] });
    else if (match[4] !== undefined) tokens.push({ kind: 'literal', text: match[4] });
    else if (match[5] !== undefined) tokens.push({ kind: 'punct', text: match[5] });
    else tokens.push({ kind: 'comment', text: match[6]! });
    last = at + match[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last) });
  return tokens;
}

function quotedOrValue(text: string): Token[] {
  const trimmed = text.trim();
  if (/^(["']).*\1$/.test(trimmed)) {
    const lead = text.slice(0, text.indexOf(trimmed));
    return [{ text: lead }, { kind: 'string', text: trimmed }, { text: text.slice(lead.length + trimmed.length) }];
  }
  return value(text);
}

function yaml(line: string): Token[] {
  const [code, comment] = splitComment(line, '#');
  const tokens: Token[] = [];
  const dash = /^(\s*-\s+)/.exec(code);
  let rest = code;
  if (dash) { tokens.push({ kind: 'punct', text: dash[1]! }); rest = code.slice(dash[1]!.length); }
  const key = /^(\s*[^\s:#][^:#]*?)(:)(\s|$)/.exec(rest);
  if (key) {
    tokens.push({ kind: 'key', text: key[1]! }, { kind: 'punct', text: key[2]! });
    tokens.push(...quotedOrValue(rest.slice(key[1]!.length + 1)));
  } else if (rest.trim()) tokens.push(...quotedOrValue(rest));
  else tokens.push({ text: rest });
  if (comment) tokens.push({ kind: 'comment', text: comment });
  return tokens;
}

function toml(line: string): Token[] {
  const [code, comment] = splitComment(line, '#');
  const tokens: Token[] = [];
  if (/^\s*\[.*\]\s*$/.test(code)) tokens.push({ kind: 'section', text: code });
  else {
    const at = code.indexOf('=');
    if (at < 0) tokens.push({ text: code });
    else tokens.push({ kind: 'key', text: code.slice(0, at) }, { kind: 'punct', text: '=' }, ...quotedOrValue(code.slice(at + 1)));
  }
  if (comment) tokens.push({ kind: 'comment', text: comment });
  return tokens;
}

function markdown(line: string, state: { fence: boolean }): Token[] {
  if (/^\s*(```|~~~)/.test(line)) { state.fence = !state.fence; return [{ kind: 'code', text: line }]; }
  if (state.fence) return [{ kind: 'code', text: line }];
  if (/^\s{0,3}#{1,6}\s/.test(line)) return [{ kind: 'heading', text: line }];
  if (/^\s*>/.test(line)) return [{ kind: 'comment', text: line }];
  const tokens: Token[] = [];
  const list = /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(line);
  let rest = line;
  if (list) { tokens.push({ kind: 'punct', text: list[1]! }); rest = line.slice(list[1]!.length); }
  let last = 0;
  for (const match of rest.matchAll(/(`[^`]*`)|(\[[^\]]*\]\([^)]*\))/g)) {
    const at = match.index ?? 0;
    if (at > last) tokens.push({ text: rest.slice(last, at) });
    tokens.push({ kind: match[1] ? 'code' : 'key', text: match[0] });
    last = at + match[0].length;
  }
  if (last < rest.length) tokens.push({ text: rest.slice(last) });
  return tokens;
}

function log(line: string): Token[] {
  const time = /^(\[?\d{2}:\d{2}:\d{2}\]?\s*)/.exec(line);
  const rest = time ? line.slice(time[1]!.length) : line;
  const kind: TokenKind | undefined = /\b(ERROR|FATAL|SEVERE)\b/.test(rest) ? 'error' : /\bWARN(ING)?\b/.test(rest) ? 'warn' : undefined;
  return [...(time ? [{ kind: 'muted' as const, text: time[1]! }] : []), { kind, text: rest }];
}

/** Tokens for one line; `fence` carries Markdown's open code block from line to line. */
export function highlightLine(line: string, language: CodeLanguage, state = { fence: false }): Token[] {
  switch (language) {
    case 'properties': return properties(line);
    case 'json': return json(line);
    case 'yaml': return yaml(line);
    case 'toml': return toml(line);
    case 'markdown': return markdown(line, state);
    case 'log': return log(line);
    default: return [{ text: line }];
  }
}

/** Whether a Markdown code block is open when line `index` starts. */
function fenceOpenAt(lines: readonly string[], index: number): boolean {
  let open = false;
  for (let row = 0; row < index; row++) if (/^\s*(```|~~~)/.test(lines[row]!)) open = !open;
  return open;
}

const escape = (text: string) => text.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'));

/**
 * HTML for lines `first` to `last` (inclusive) of the text: escaped text in token spans, with
 * search matches wrapped in <mark> (`current` is the one the editor moved to). `starts` holds
 * each line's offset in the text; matches are [start, end) offsets, sorted.
 */
export function highlightWindow(
  lines: readonly string[], starts: readonly number[], language: CodeLanguage, first: number, last: number,
  matches: readonly [number, number][] = [], current = -1,
): string {
  const state = { fence: language === 'markdown' && fenceOpenAt(lines, first) };
  const windowStart = starts[first] ?? 0;
  // The first match that could touch the window.
  let next = 0;
  let low = 0, high = matches.length;
  while (low < high) { const mid = (low + high) >> 1; if (matches[mid]![1] <= windowStart) low = mid + 1; else high = mid; }
  next = low;
  const open = (index: number) => `<mark${index === current ? ' data-current' : ''}>`;
  let html = '';
  for (let row = first; row <= last && row < lines.length; row++) {
    const line = lines[row]!;
    let offset = starts[row]!;
    for (const token of highlightLine(line, language, state)) {
      if (!token.text) continue;
      const end = offset + token.text.length;
      let piece = '';
      let cursor = offset;
      while (next < matches.length && matches[next]![0] < end) {
        const [from, to] = matches[next]!;
        if (to <= cursor) { next++; continue; }
        const a = Math.max(from, cursor);
        const b = Math.min(to, end);
        piece += escape(line.slice(cursor - starts[row]!, a - starts[row]!)) + open(next) + escape(line.slice(a - starts[row]!, b - starts[row]!)) + '</mark>';
        cursor = b;
        if (to <= end) next++;
        else break;
      }
      piece += escape(line.slice(cursor - starts[row]!, end - starts[row]!));
      html += token.kind ? `<span data-token="${token.kind}">${piece}</span>` : piece;
      offset = end;
    }
    html += '\n';
  }
  return html;
}

/** Each line's start offset in the text. */
export function lineStarts(lines: readonly string[]): number[] {
  const starts = new Array<number>(lines.length);
  let offset = 0;
  for (let row = 0; row < lines.length; row++) { starts[row] = offset; offset += lines[row]!.length + 1; }
  return starts;
}

/** The line holding `offset`. */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0, high = starts.length - 1;
  while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid]! <= offset) low = mid; else high = mid - 1; }
  return low;
}

/** Every case-insensitive occurrence of `query` in `text`, as [start, end) ranges. */
export function findAll(text: string, query: string, limit = 5000): [number, number][] {
  if (!query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const found: [number, number][] = [];
  for (let at = haystack.indexOf(needle); at >= 0 && found.length < limit; at = haystack.indexOf(needle, at + needle.length)) {
    found.push([at, at + needle.length]);
  }
  return found;
}
