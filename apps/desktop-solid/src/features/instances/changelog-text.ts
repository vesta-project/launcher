const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

export function changelogPlainText(raw: string, format: string): string {
  if (format !== 'html') return raw.trim();
  // The update preview renders this as text. Interpret each original token once.
  return raw
    .replace(/(<br\s*\/?>|<\/(?:p|li|h\d)>)|<[^>]+>|&(amp|lt|gt|quot|#39);/gi,
      (token, lineBreak, entity) => lineBreak ? '\n' : entity ? entities[token.toLowerCase()]! : '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
