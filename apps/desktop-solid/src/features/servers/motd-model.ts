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

export type MotdProblem = 'too-many-lines' | 'too-long' | 'unknown-placeholder' | 'unclosed-placeholder';

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
