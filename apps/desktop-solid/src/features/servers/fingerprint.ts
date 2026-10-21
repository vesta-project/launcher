// TLS leaf SHA-256 fingerprints, as printed by `vesta-agent owner link` and the
// pairing output, accepted with or without colons, spaces or uppercase.

/** Lowercase 64-character hex, or null when the input is not a SHA-256 fingerprint. */
export function normalizeFingerprint(input: string): string | null {
  const hex = input.replace(/[\s:-]/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** Groups of four for reading aloud or comparing side by side. */
export function groupFingerprint(fingerprint: string): string[] {
  const hex = normalizeFingerprint(fingerprint) ?? fingerprint.toLowerCase();
  return hex.match(/.{1,4}/g) ?? [];
}

export function sameFingerprint(left: string | null | undefined, right: string | null | undefined) {
  const a = left ? normalizeFingerprint(left) : null;
  const b = right ? normalizeFingerprint(right) : null;
  return a !== null && a === b;
}

/** Indexes of four-character groups that differ, so a mismatch can be highlighted. */
export function differingGroups(expected: string, actual: string): number[] {
  const left = groupFingerprint(expected);
  const right = groupFingerprint(actual);
  const length = Math.max(left.length, right.length);
  return Array.from({ length }, (_, index) => index).filter((index) => left[index] !== right[index]);
}
