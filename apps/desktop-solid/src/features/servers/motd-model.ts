// Minecraft server-list text: `§` colour/style codes, `{placeholder}` substitution and the
// agent's template limits, so the editor can preview and validate as you type. The agent
// renders and validates again (motd/preview) before anything is saved.

export const MOTD_COLORS: Record<string, string> = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA', '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};
export const MOTD_STYLES = { k: 'obfuscated', l: 'bold', m: 'strikethrough', n: 'underlined', o: 'italic' } as const;

/** Placeholders the agent accepts in presentation templates. */
export const MOTD_PLACEHOLDERS = [
  'server_name', 'state', 'online_players', 'max_players', 'minecraft_version', 'loader_version', 'pack_name', 'pack_version',
  'maintenance_reason', 'queued_operation', 'elapsed_seconds', 'estimated_ready_seconds', 'public_failure',
] as const;

export interface MotdSegment {
  text: string;
  color: string | null;
  bold: boolean;
  italic: boolean;
  underlined: boolean;
  strikethrough: boolean;
  obfuscated: boolean;
  line: 0 | 1;
}

const plain = (line: 0 | 1): Omit<MotdSegment, 'text'> => ({ color: null, bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false, line });

/** Splits a template into styled segments. A colour code resets styles, like Minecraft. */
export function parseMotd(template: string): MotdSegment[] {
  const segments: MotdSegment[] = [];
  const lines = template.replace(/\\n/g, '\n').split('\n').slice(0, 2);
  lines.forEach((source, index) => {
    const line = index as 0 | 1;
    let style = plain(line);
    let text = '';
    const flush = () => { if (text) { segments.push({ ...style, text }); text = ''; } };
    for (let at = 0; at < source.length; at++) {
      const char = source[at]!;
      const code = source[at + 1]?.toLowerCase();
      if (char === '§' && code !== undefined) {
        if (code in MOTD_COLORS) { flush(); style = { ...plain(line), color: MOTD_COLORS[code]! }; at++; continue; }
        if (code in MOTD_STYLES) { flush(); style = { ...style, [MOTD_STYLES[code as keyof typeof MOTD_STYLES]]: true }; at++; continue; }
        if (code === 'r') { flush(); style = plain(line); at++; continue; }
      }
      text += char;
    }
    flush();
  });
  return segments;
}

/** Replaces known placeholders with sample values for the preview. */
export function fillPlaceholders(template: string, values: Partial<Record<(typeof MOTD_PLACEHOLDERS)[number], string>>) {
  return template.replace(/\{([a-z_]+)\}/g, (match, name: string) => values[name as keyof typeof values] ?? match);
}

export type MotdStyle = Omit<MotdSegment, 'text' | 'line'>;

/** One piece of the source text, so an editor can draw every character of it in place. */
export type MotdToken =
  | { kind: 'code'; text: string }
  | { kind: 'newline'; text: string }
  | { kind: 'text' | 'placeholder'; text: string; style: MotdStyle };

const plainStyle = (): MotdStyle => {
  const { line: _line, ...style } = plain(0);
  return style;
};

/** The style after applying one code, or null when it isn't a code. Colours reset styles, like Minecraft. */
function applyCode(style: MotdStyle, code: string): MotdStyle | null {
  if (code in MOTD_COLORS) return { ...plainStyle(), color: MOTD_COLORS[code]! };
  if (code in MOTD_STYLES) return { ...style, [MOTD_STYLES[code as keyof typeof MOTD_STYLES]]: true };
  if (code === 'r') return plainStyle();
  return null;
}

/**
 * Splits the source into codes, text, placeholders and line breaks, keeping every
 * character: joining the token texts gives the template back exactly.
 */
export function motdTokens(template: string): MotdToken[] {
  const tokens: MotdToken[] = [];
  let style = plainStyle();
  let text = '';
  const flush = () => { if (text) { tokens.push({ kind: 'text', text, style }); text = ''; } };
  for (let at = 0; at < template.length; at++) {
    const char = template[at]!;
    if (char === '\n' || (char === '\\' && template[at + 1] === 'n')) {
      flush();
      tokens.push({ kind: 'newline', text: char === '\n' ? '\n' : '\\n' });
      if (char === '\\') at++;
      style = plainStyle();
      continue;
    }
    if (char === '§' && at + 1 < template.length) {
      const next = applyCode(style, template[at + 1]!.toLowerCase());
      if (next) { flush(); tokens.push({ kind: 'code', text: template.slice(at, at + 2) }); style = next; at++; continue; }
    }
    if (char === '{') {
      const match = /^\{[a-z_]+\}/.exec(template.slice(at));
      if (match) { flush(); tokens.push({ kind: 'placeholder', text: match[0], style }); at += match[0].length - 1; continue; }
    }
    text += char;
  }
  flush();
  return tokens;
}

const colorCode = (color: string | null) => Object.entries(MOTD_COLORS).find(([, value]) => value === color)?.[0] ?? null;
const styleCodes = (style: MotdStyle) =>
  (Object.entries(MOTD_STYLES) as [string, keyof MotdStyle][]).filter(([, name]) => style[name]).map(([code]) => `§${code}`).join('');

/** Codes that recreate the style in effect at `index` (an empty string for plain text). */
export function activeCodesAt(template: string, index: number): string {
  let style = plainStyle();
  let at = 0;
  for (const token of motdTokens(template)) {
    if (at >= index) break;
    if (token.kind === 'newline') style = plainStyle();
    else if (token.kind === 'code') style = applyCode(style, token.text[1]!.toLowerCase()) ?? style;
    at += token.text.length;
  }
  const color = colorCode(style.color);
  return (color ? `§${color}` : '') + styleCodes(style);
}

/** Removes colour and style codes, leaving the text and placeholders. */
export const stripMotdCodes = (template: string) =>
  motdTokens(template).filter((token) => token.kind !== 'code').map((token) => token.text).join('');

/**
 * Applies a toolbar code to the selection. With no selection it is inserted at the cursor;
 * with one, the selection is wrapped and the style that followed it is restored after it,
 * so the rest of the line keeps its look. `r` clears formatting inside the selection.
 */
export function applyMotdFormat(template: string, start: number, end: number, code: string): { template: string; start: number; end: number } {
  const insert = `§${code}`;
  if (start === end) return { template: template.slice(0, start) + insert + template.slice(start), start: start + 2, end: start + 2 };
  const before = template.slice(0, start);
  const selected = code === 'r' ? stripMotdCodes(template.slice(start, end)) : template.slice(start, end);
  const after = template.slice(end);
  const lineContinues = after.length > 0 && !after.startsWith('\n') && !after.startsWith('\\n');
  const restore = lineContinues ? `§r${activeCodesAt(template, end)}` : '';
  return { template: before + insert + selected + restore + after, start: start + 2, end: start + 2 + selected.length };
}

/** Writes segments back to source text with the fewest codes that reproduce them. */
export function serializeMotd(segments: readonly MotdSegment[]): string {
  const lines: string[] = ['', ''];
  let line: 0 | 1 = 0;
  let style = plainStyle();
  for (const segment of segments) {
    if (segment.line !== line) { line = segment.line; style = plainStyle(); }
    const { text, line: _line, ...next } = segment;
    let codes = '';
    const dropsStyle = (Object.values(MOTD_STYLES) as (keyof MotdStyle)[]).some((name) => style[name] && !next[name]);
    if (next.color !== style.color || dropsStyle) {
      const color = colorCode(next.color);
      codes = (color ? `§${color}` : '§r') + styleCodes(next);
    } else {
      codes = (Object.entries(MOTD_STYLES) as [string, keyof MotdStyle][]).filter(([, name]) => next[name] && !style[name]).map(([code]) => `§${code}`).join('');
    }
    lines[line] += codes + text;
    style = next;
  }
  return lines[1] ? `${lines[0]}\n${lines[1]}` : lines[0]!;
}

export type MotdProblem ='too-many-lines' | 'too-long' | 'unknown-placeholder' | 'unclosed-placeholder';

/** The agent's template limits: two lines, 1,024 source bytes, known placeholders only. */
export function motdProblems(template: string): MotdProblem[] {
  const problems: MotdProblem[] = [];
  if (template.replace(/\\n/g, '\n').split('\n').length > 2) problems.push('too-many-lines');
  if (new TextEncoder().encode(template).length > 1024) problems.push('too-long');
  for (const match of template.matchAll(/\{([^}]*)\}/g)) {
    if (!(MOTD_PLACEHOLDERS as readonly string[]).includes(match[1]!)) { problems.push('unknown-placeholder'); break; }
  }
  if (/\{[^}]*$/.test(template)) problems.push('unclosed-placeholder');
  return problems;
}
