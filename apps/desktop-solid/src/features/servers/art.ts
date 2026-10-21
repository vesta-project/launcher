// Deterministic artwork for servers, which have no cover art of their own: a tinted
// block pattern seeded by the stable server id, used wherever an instance shows its image
// (cards, the page header, pinned rail tiles), so servers sit in the same visual system.

function hash(seed: string) {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Small deterministic generator so the same seed always draws the same blocks. */
function random(seed: number) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
}

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('') || '?';
}

/**
 * An SVG data URL: a two-tone gradient with a scatter of square "blocks". With `label`,
 * initials are drawn in the centre for small tiles such as pinned rail items.
 */
export function serverArt(seed: string, label?: string): string {
  const value = hash(seed);
  const hue = value % 360;
  const next = random(value);
  const blocks = Array.from({ length: 18 }, () => {
    const size = 8 + Math.floor(next() * 4) * 8;
    const x = Math.floor(next() * 16) * 8;
    const y = Math.floor(next() * 16) * 8;
    const alpha = (0.05 + next() * 0.14).toFixed(2);
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="white" fill-opacity="${alpha}"/>`;
  }).join('');
  const text = label
    ? `<text x="64" y="64" dy="0.35em" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-weight="800" font-size="46" fill="white" fill-opacity="0.95">${escapeXml(label)}</text>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue} 46% 46%)"/><stop offset="1" stop-color="hsl(${(hue + 38) % 360} 52% 20%)"/>`
    + `</linearGradient></defs><rect width="128" height="128" fill="url(#g)"/>${blocks}${text}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
